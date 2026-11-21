# CertiFlow - Skilling Certificate Issuance Platform

Training centres upload passed batches, officers approve them, every candidate gets their certificate on WhatsApp, and anyone can check whether a certificate is genuine.

> Setup: see [SETUP.md](SETUP.md). Production plan: see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 1. Requirements note (decisions where the brief was unclear)

| # | Question in the brief | Decision | Why |
|---|---|---|---|
| 1 | "A district decision needs more than one officer" | **2 different officers** from the batch's district must approve. Any **one** officer can send back or reject. | Two people check every batch; a single "no" is enough to stop a bad batch. |
| 2 | "Big batches need extra scrutiny" | Batches with **more than 50 candidates** go to the **quality team** after district approval. Setting: `BIG_BATCH_SIZE`. | A clear, testable rule. |
| 3 | "The state office has the final say" | The state office gives final approval. It may also send back or reject at **any** review stage. | It "deals with anything that goes wrong". |
| 4 | What happens to earlier approvals when a sent-back batch is resubmitted? | **They no longer count.** Resubmitting starts a new **round**, and review starts again at district. Old approvals stay in the audit log. | Those approvals were given for different data. Re-approving is cheap; approving changed data by accident is not. |
| 5 | "Officers make mistakes, they should be able to fix them" | An officer can **withdraw their own approval** while the batch is still at district. After that, only the state office can fix things (send back, or cancel a certificate). | Clear ownership of each step. |
| 6 | "Files sitting with an officer for days" | A batch with **no action for 2 minutes in the demo** (48 hours in real life) is **escalated**: the state office gets an alert, and the batch is flagged. Setting: `STUCK_AFTER_SECONDS`. | Nobody has to chase anything. |
| 7 | How does anyone check a certificate without exposing personal data? | Check needs the **certificate number + an 8-character code** printed on the certificate. It shows name, course, grade, centre and date. **Never** the phone number. Wrong code and unknown number give the same answer. | Stops people scanning numbers to collect names. |
| 8 | Spreadsheet format | **CSV** with columns `name, phone, course, grade`. Up to 500 rows. **If any row is bad, nothing is saved** and every problem is listed with its row number. | Nothing half-saved. |
| 9 | Login | **Demo only:** pick a person, no password. The server issues a signed token (JWT) with the role inside. | The brief asks reviewers to switch people instantly. A real system would use OTP or government SSO. |
| 10 | How does the candidate download it? | The WhatsApp message carries a link with a long random token. The link stops working if the certificate is cancelled. | No login needed for candidates; impossible to guess. |

---

## 2. How it is put together

```
React app ──HTTP──▶ API (Express) ──▶ PostgreSQL   (source of truth)
    ▲                    │
    │ live updates (SSE) │ adds jobs
    └──── Redis ◀────────┘   Redis = job queue (BullMQ) + live messages (pub/sub) + verify cache
             │
             ▼
          Worker ──▶ PDF ──▶ Fake WhatsApp (fails 30%, sometimes slow)
             └──▶ every 30 s: "sweep" job (escalate stuck batches, re-queue undelivered certificates)
```

| Service | What it does |
|---|---|
| `api` | Express + TypeScript. All requests. Stateless (no sessions in memory), so you can run many copies. |
| `worker` | Same code, different start command. Makes PDFs and sends WhatsApp messages from the queue. |
| `postgres` | Everything that matters. Prisma migrations in `api/prisma/migrations`. |
| `redis` | BullMQ job queue, pub/sub for live updates, 30-second cache for public checks. Runs with `appendonly yes` so jobs survive a restart. |
| `fake-whatsapp` | Stand-in for the WhatsApp API. Fails, times out, and remembers idempotency keys like the real one. Inbox page at http://localhost:4000. |
| `web` | React + Vite. One page: person switcher, batch list, batch detail, verify page. |

**Why BullMQ (queue choice):** it runs on the Redis we already need, retries with backoff, recovers jobs from crashed workers ("stalled jobs"), and supports repeating jobs (our sweep). One less moving part than adding RabbitMQ or Kafka.

### Where each step of the build lives

| Step | Files |
|---|---|
| 1. Skeleton, database, demo data | `docker-compose.yml`, `api/prisma/schema.prisma`, `api/prisma/migrations/`, `api/src/demo-data.ts` |
| 2. Login and roles | `api/src/auth.ts`, `api/src/routes/auth.routes.ts` |
| 3. Batch + CSV upload | `api/src/services/csv.ts`, `api/src/routes/batch.routes.ts` |
| 4. Approval flow | `api/src/services/workflow.ts` |
| 5. Certificates + WhatsApp | `api/src/worker.ts`, `api/src/services/issue.ts`, `pdf.ts`, `whatsapp.ts`, `fake-whatsapp/server.js` |
| 6. Verify + cancel | `api/src/services/certificates.ts`, `api/src/routes/public.routes.ts`, `api/src/routes/ops.routes.ts` |
| 7. Escalation + live updates | `api/src/services/sweep.ts`, live part of `public.routes.ts`, `web/src/useLive.ts` |
| 8. Tests | `api/tests/*.test.ts` |
| Frontend | `web/src/` |

---

## 3. How each "moment that must work" is guaranteed

| Moment | How | Test |
|---|---|---|
| 1. Bad rows in the spreadsheet | Every row checked with zod first. Any error → 422 with `{row, field, message}` for each problem. Only a fully valid file is saved, in one transaction. | `upload.test.ts` |
| 2. Two officers approve at the same moment | Every action locks the batch row (`SELECT ... FOR UPDATE`) inside a transaction, so actions on one batch happen one after another. The status change also uses `UPDATE ... WHERE status = <old status>` as a second guard. A unique rule stops one officer approving twice. | `approval.test.ts` |
| 3. 60 candidates, unreliable WhatsApp | Each candidate is one queue job, retried with backoff. Each step is safe to repeat: the database allows **one certificate per candidate**; the PDF is the same file; WhatsApp gets the **same idempotency key** every retry, so a retry after a timeout never sends twice. A sweep job re-queues anything still undelivered. | `issue.test.ts` (flaky provider + duplicate job runs) |
| 4. Cancelled certificate checked a minute later | Cancelling deletes the cached answer immediately. Even in a rare race, the cache only lives 30 seconds. The download link returns 410. | `verify.test.ts` |
| 5. Batch untouched too long | Sweep job (every 30 s) finds review batches with no action for too long, alerts the state office, flags the batch. A "claim" update makes sure only one alert is sent, even with many workers. | `escalation.test.ts` |
| 6. Send back and resubmit | New round; old approvals don't count (decision 4). | `approval.test.ts` |

## 4. How each "must never happen" is prevented

| Never | Prevention |
|---|---|
| Acting at a step that isn't yours | `canReview()` checks role **and** district for the batch's current stage, inside the locked transaction. |
| Acting as someone else | Identity and role come only from the signed JWT (HS256 only, `alg: none` refused). Role in a request body is ignored. |
| Two certificates for one candidate / shared number | Unique `candidateId` and unique `seq` (database counter) on `Certificate`. |
| Cancelled certificate showing as genuine | Cache deleted on cancel + 30 s max cache life; status read from the database. |
| A stranger getting someone's certificate or details | Verify needs number + secret code, never shows phone; download needs a 64-character random token; users only see batches of their own centre/district; rate limits on public endpoints. |
| A decision that can't be traced | Every action writes an `AuditLog` row (who, role, what, when, details) **in the same transaction** as the change. Batch detail shows the full timeline; `GET /api/trace/:id` shows the history of any batch or certificate. |

## 5. Technical expectations

- **Event-driven:** approval adds jobs to the queue and publishes events; the worker and live updates react to them. A user never waits for a PDF or WhatsApp.
- **Scalable:** API is stateless; workers scale with `docker compose up --scale worker=3`. Correctness doesn't depend on any one instance: locks and unique rules live in Postgres, jobs live in Redis.
- **Containerised:** `docker compose up --build`.
- **Tested:** `docker compose exec api npm test` (separate test database).
- **Secure:** JWT + role and ownership checks, zod validation on every input, helmet headers, rate limits, unguessable tokens, no personal data in public responses.
- **Observable:** structured JSON logs (pino) with a request id on every line; audit log timeline per batch and per certificate; queue health for the state office.

## 6. Known limitations and next steps (honest list)

- Demo login has no password (by design for the demo). Real system: OTP/SSO.
- The live-updates token is passed in the URL (browser EventSource can't send headers). Next step: short-lived, single-use stream tickets.
- If the API crashes in the tiny gap after saving an approval but before queuing jobs, the sweep job queues them within 30 seconds (not instantly). A transactional outbox would close the gap.
- PDFs are stored on a shared Docker volume. Production: S3 with signed URLs (see DEPLOYMENT.md).
- CSV only, no Excel. Row numbers skip blank lines.
- The fake WhatsApp keeps messages in memory; restarting it empties the inbox page.
- Containers run TypeScript directly with `tsx` (simple for the demo); production would build to JavaScript first.
- The web container runs the Vite dev server; production would serve the built files from a CDN.

## 7. AI usage

AI (Claude) was used to draft the code, tests and documents from my plan.
How I checked it: *(fill this in honestly before submitting: e.g. "read every file, ran all tests, changed X because Y, found and fixed bug Z")*.

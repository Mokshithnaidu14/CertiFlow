# Local setup

## You need
- Docker Desktop (or Docker Engine + Compose v2)
- Free ports: 5173, 3000, 4000, 5432, 6379

## Start everything (one command)
```bash
docker compose up --build
```
The first build takes a few minutes. When you see `API listening on port 3000`, open:

| What | URL |
|---|---|
| App | http://localhost:5173 |
| Fake WhatsApp inbox ("the phones") | http://localhost:4000 |
| API health | http://localhost:3000/health |

The API runs the database migrations and loads demo data on every start (safe to repeat).

## Run the tests
In a second terminal, while the system is running:
```bash
docker compose exec api npm test
```
Tests use a separate database (`certiflow_test`) and Redis db 1, so your demo data is not touched.

## Try the demo (2 minutes)
Switch people with the "Acting as" menu at the top right.

1. **Anika (training centre):** open the sample batch, or create one and upload `sample-data/batch-5-candidates.csv`. Try `sample-data/batch-with-bad-rows.csv` first to see the row errors (nothing is saved). Click **Send for approval**.
2. **Dev**, then **Meera** (district officers): **Approve**. One approval is not enough; after the second it moves on.
3. **Farah (state office):** **Approve**. Certificates start going out.
4. Open http://localhost:4000: each phone gets exactly one message, even though the fake WhatsApp fails 30% of the time. Click a download link to see the PDF.
5. **Verify a certificate** (top menu, no login needed): enter the number and code from the PDF.
6. **Farah:** type a reason and **Cancel** a certificate. Check it again: it now shows as cancelled.
7. **Escalation:** submit a batch and leave it for 2 minutes. Farah sees an alert and the batch is flagged.
8. **Big batch:** upload `sample-data/batch-60-candidates.csv`. After two district approvals it goes to **Neha (quality team)**.

## Useful commands
```bash
docker compose up --scale worker=3     # more workers
docker compose logs -f worker          # watch certificates being issued and retried
docker compose down -v                 # stop and delete all data (fresh start)
```

## Troubleshooting
- **Tests fail with "database certiflow_test does not exist":** the test database is created only when the Postgres volume is first created. Run `docker compose down -v` and start again.
- **Port already in use:** stop the other program, or change the left-hand port in `docker-compose.yml`.
- After the first successful `npm install`, commit the generated `package-lock.json` files so every build uses the same versions.

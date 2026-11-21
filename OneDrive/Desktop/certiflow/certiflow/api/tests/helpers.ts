import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedDemoData } from '../src/demo-data';
import { prisma, redis } from '../src/infra';

export const app = createApp();

export async function resetDb() {
  // Guard: never wipe the demo database by accident. "npm test" sets these to the test ones.
  if (!process.env.DATABASE_URL?.includes('_test') || !process.env.REDIS_URL?.endsWith('/1')) {
    throw new Error('Run the tests with "npm test" so they use the test database and Redis db 1');
  }
  await redis.flushdb(); // test Redis db only (db 1): clears cache, rate limits and queued jobs
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "Notification", "Certificate", "Approval", "Candidate", "Batch", "User", "Centre", "District" RESTART IDENTITY CASCADE',
  );
  await seedDemoData(prisma, { withSampleBatch: false });
  // A second district + centre, to prove people can't touch things outside their area.
  await prisma.district.create({ data: { id: 'district-south', name: 'South District' } });
  await prisma.centre.create({ data: { id: 'centre-other', name: 'Other Centre', districtId: 'district-south' } });
  await prisma.user.create({ data: { id: 'ravi', name: 'Ravi', role: 'OFFICER', districtId: 'district-south' } });
  await prisma.user.create({ data: { id: 'omar', name: 'Omar', role: 'CENTRE', centreId: 'centre-other' } });
}

export async function tokenFor(userId: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ userId });
  if (res.status !== 200) throw new Error(`login failed for ${userId}`);
  return res.body.token;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function letters(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// A valid CSV with n candidates: names "Candidate A", "Candidate B"...; phones 9000000001...
export function csvFor(n: number): string {
  const lines = ['name,phone,course,grade'];
  for (let i = 1; i <= n; i++) lines.push(`Candidate ${letters(i)},9${String(i).padStart(9, '0')},Electrician,A`);
  return lines.join('\n');
}

export async function createBatch(candidates: number): Promise<string> {
  const anika = await tokenFor('anika');
  const created = await request(app).post('/api/batches').set(auth(anika)).send({ name: 'Test batch' }).expect(201);
  await request(app)
    .put(`/api/batches/${created.body.id}/candidates`)
    .set(auth(anika))
    .set('Content-Type', 'text/csv')
    .send(csvFor(candidates))
    .expect(200);
  return created.body.id;
}

export async function createSubmittedBatch(candidates: number): Promise<string> {
  const id = await createBatch(candidates);
  await request(app).post(`/api/batches/${id}/submit`).set(auth(await tokenFor('anika'))).expect(200);
  return id;
}

export async function approve(userId: string, batchId: string) {
  return request(app).post(`/api/batches/${batchId}/approve`).set(auth(await tokenFor(userId)));
}

// Takes a batch all the way to APPROVED.
export async function createApprovedBatch(candidates: number): Promise<string> {
  const id = await createSubmittedBatch(candidates);
  await mustApprove('dev', id);
  await mustApprove('meera', id);
  const b = await prisma.batch.findUniqueOrThrow({ where: { id } });
  if (b.status === 'QUALITY_REVIEW') await mustApprove('neha', id);
  await mustApprove('farah', id);
  return id;
}

async function mustApprove(userId: string, batchId: string) {
  const res = await approve(userId, batchId);
  if (res.status !== 200) throw new Error(`approval by ${userId} failed: ${res.status} ${JSON.stringify(res.body)}`);
}

// A local stand-in for WhatsApp, like the fake-whatsapp container: fails often, sometimes slow,
// and delivers each idempotency key only once.
export async function startFakeWhatsApp(opts: { failRate: number; slowRate: number; slowMs?: number }) {
  const delivered = new Map<string, { to: string; text: string }>();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      const key = msg.idempotencyKey as string;
      const roll = Math.random();
      if (roll < opts.failRate) {
        res.writeHead(503).end();
        return;
      }
      if (!delivered.has(key)) delivered.set(key, { to: msg.to, text: msg.text });
      const reply = () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: key }));
      if (roll < opts.failRate + opts.slowRate) setTimeout(reply, opts.slowMs ?? 300); // delivered, answers late
      else reply();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  process.env.WHATSAPP_URL = `http://127.0.0.1:${port}`;
  return {
    delivered,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Plays the role of the queue: run a job, and retry it if it throws.
export async function runWithRetries<T>(job: () => Promise<T>, maxAttempts = 40): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await job();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 20)); // small backoff, like the queue
    }
  }
  throw lastError;
}

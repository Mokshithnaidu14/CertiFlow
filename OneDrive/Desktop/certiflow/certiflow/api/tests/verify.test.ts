// MOMENT 4: the state office cancels a certificate -> an employer checking it is told it's no longer valid.
// NEVER: a cancelled certificate showing as genuine; a stranger getting personal details.
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma, redis } from '../src/infra';
import { certNumber, verifyCacheKey } from '../src/services/certificates';
import { issueCertificate } from '../src/services/issue';
import { app, auth, createApprovedBatch, startFakeWhatsApp, tokenFor } from './helpers';

let provider: Awaited<ReturnType<typeof startFakeWhatsApp>> | undefined;
afterEach(async () => {
  await provider?.close();
  provider = undefined;
});

async function oneCertificate() {
  provider = await startFakeWhatsApp({ failRate: 0, slowRate: 0 });
  process.env.WHATSAPP_TIMEOUT_MS = '2000';
  const batchId = await createApprovedBatch(2);
  const [candidate] = await prisma.candidate.findMany({ where: { batchId } });
  await issueCertificate(candidate.id);
  const cert = await prisma.certificate.findUniqueOrThrow({ where: { candidateId: candidate.id } });
  return { cert, number: certNumber(cert.seq) };
}

describe('public verification', () => {
  it('a cancelled certificate shows as not valid straight away, even though it was cached', async () => {
    const { cert, number } = await oneCertificate();

    const before = await request(app).get(`/api/verify/${number}?code=${cert.verifyCode}`).expect(200);
    expect(before.body.valid).toBe(true);
    expect(await redis.get(verifyCacheKey(number))).not.toBeNull(); // the answer is now cached

    const farah = await tokenFor('farah');
    await request(app).post(`/api/certificates/${cert.id}/revoke`).set(auth(farah)).send({ reason: 'Issued by mistake' }).expect(200);

    const after = await request(app).get(`/api/verify/${number}?code=${cert.verifyCode}`).expect(200);
    expect(after.body.valid).toBe(false);
    expect(after.body.status).toBe('REVOKED');

    // The download link stops working too.
    await request(app).get(`/api/certificates/download/${cert.downloadToken}`).expect(410);
  });

  it('shows only what an employer needs (no phone number)', async () => {
    const { cert, number } = await oneCertificate();
    const res = await request(app).get(`/api/verify/${number}?code=${cert.verifyCode}`).expect(200);
    expect(res.body).not.toHaveProperty('phone');
    expect(JSON.stringify(res.body)).not.toMatch(/9\d{9}/);
  });

  it('a wrong code reveals nothing, exactly like a number that does not exist', async () => {
    const { number } = await oneCertificate();
    const wrong = await request(app).get(`/api/verify/${number}?code=ZZZZZZZZ`).expect(404);
    const missing = await request(app).get('/api/verify/PSM-999999?code=ZZZZZZZZ').expect(404);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body).not.toHaveProperty('name');
  });

  it('a guessed download link does not work', async () => {
    await request(app).get(`/api/certificates/download/${'a'.repeat(64)}`).expect(404);
  });

  it('a certificate cannot be cancelled twice', async () => {
    const { cert } = await oneCertificate();
    const farah = await tokenFor('farah');
    await request(app).post(`/api/certificates/${cert.id}/revoke`).set(auth(farah)).send({ reason: 'First time' }).expect(200);
    await request(app).post(`/api/certificates/${cert.id}/revoke`).set(auth(farah)).send({ reason: 'Second time' }).expect(409);
  });
});

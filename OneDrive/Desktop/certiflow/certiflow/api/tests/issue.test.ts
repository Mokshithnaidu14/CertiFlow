// MOMENT 3: a batch of 60 is approved -> every candidate gets exactly one certificate on their phone,
// even though WhatsApp fails 30% of the time and sometimes answers too late.
// NEVER: two certificates for one candidate, or two certificates with the same number.
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/infra';
import { issueCertificate } from '../src/services/issue';
import { createApprovedBatch, createSubmittedBatch, runWithRetries, startFakeWhatsApp } from './helpers';

let provider: Awaited<ReturnType<typeof startFakeWhatsApp>> | undefined;
afterEach(async () => {
  await provider?.close();
  provider = undefined;
});

describe('certificate issuing', () => {
  it('60 approved candidates get exactly 60 certificates, one message each, despite an unreliable WhatsApp', async () => {
    provider = await startFakeWhatsApp({ failRate: 0.3, slowRate: 0.15, slowMs: 300 });
    process.env.WHATSAPP_TIMEOUT_MS = '100'; // "slow" answers arrive after we gave up -> we retry

    const batchId = await createApprovedBatch(60);
    const candidates = await prisma.candidate.findMany({ where: { batchId } });
    expect(candidates).toHaveLength(60);

    // Play the role of the queue (10 jobs at a time, like a worker with concurrency 10).
    // Every 5th job is also run twice at the same time, like a worker that restarted
    // and picked up a job that was already running.
    for (let start = 0; start < candidates.length; start += 10) {
      const chunk = candidates.slice(start, start + 10);
      await Promise.all(
        chunk.map((c, i) => {
          const copies = (start + i) % 5 === 0 ? 2 : 1;
          return Promise.all(Array.from({ length: copies }, () => runWithRetries(() => issueCertificate(c.id))));
        }),
      );
    }

    const certs = await prisma.certificate.findMany({ where: { candidate: { batchId } } });
    expect(certs).toHaveLength(60); // one per candidate
    expect(new Set(certs.map((c) => c.candidateId)).size).toBe(60);
    expect(new Set(certs.map((c) => c.seq)).size).toBe(60); // all numbers different
    expect(certs.every((c) => c.delivery === 'SENT')).toBe(true);

    // What the "phones" received: 60 messages, 60 different phones, nobody got two.
    expect(provider.delivered.size).toBe(60);
    expect(new Set([...provider.delivered.values()].map((m) => m.to)).size).toBe(60);
  });

  it('does nothing for a batch that is not approved', async () => {
    provider = await startFakeWhatsApp({ failRate: 0, slowRate: 0 });
    const batchId = await createSubmittedBatch(2);
    const [c] = await prisma.candidate.findMany({ where: { batchId } });
    const result = await issueCertificate(c.id);
    expect(result).toEqual({ skipped: 'batch not approved' });
    expect(await prisma.certificate.count()).toBe(0);
  });
});

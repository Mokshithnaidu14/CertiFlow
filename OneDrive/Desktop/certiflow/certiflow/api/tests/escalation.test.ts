// MOMENT 5: a batch sits untouched too long -> someone senior finds out, without anyone chasing it.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/infra';
import { escalateStuckBatches, requeueUndelivered } from '../src/services/sweep';
import { app, approve, auth, createApprovedBatch, createSubmittedBatch, tokenFor } from './helpers';

async function makeOld(batchId: string, minutes: number) {
  await prisma.batch.update({ where: { id: batchId }, data: { lastActionAt: new Date(Date.now() - minutes * 60_000) } });
}

describe('escalation', () => {
  it('alerts the state office once about a stuck batch, even if two sweeps run at the same time', async () => {
    const id = await createSubmittedBatch(3);
    await makeOld(id, 10);

    const [a, b] = await Promise.all([escalateStuckBatches(), escalateStuckBatches()]);
    expect(a + b).toBe(1);
    expect(await escalateStuckBatches()).toBe(0); // not again

    const farah = await tokenFor('farah');
    const notes = await request(app).get('/api/notifications').set(auth(farah)).expect(200);
    expect(notes.body).toHaveLength(1);
    expect(notes.body[0].batchId).toBe(id);
  });

  it('does not escalate batches that are moving', async () => {
    await createSubmittedBatch(3); // just submitted
    expect(await escalateStuckBatches()).toBe(0);
  });

  it('acting on an escalated batch clears the flag and resets the timer', async () => {
    const id = await createSubmittedBatch(3);
    await makeOld(id, 10);
    await escalateStuckBatches();
    await approve('dev', id);
    await approve('meera', id); // moves to STATE_REVIEW
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
    expect(batch.escalatedAt).toBeNull();
  });

  it('the safety net finds approved candidates with no certificate yet', async () => {
    const id = await createApprovedBatch(4);
    expect(await requeueUndelivered()).toBe(4);
    expect(id).toBeTruthy();
  });
});

// MOMENT 2: two officers approve at the same moment -> the batch moves forward once.
// MOMENT 6: send back + resubmit -> old approvals deliberately stop counting.
// NEVER: someone acting at a step that is not theirs; a decision without who/when.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/infra';
import { app, approve, auth, createApprovedBatch, createSubmittedBatch, csvFor, tokenFor } from './helpers';

async function movesTo(batchId: string, status: string) {
  const logs = await prisma.auditLog.findMany({ where: { batchId, action: 'batch.moved' } });
  return logs.filter((l) => (l.details as { to?: string } | null)?.to === status).length;
}

describe('approval flow', () => {
  it('two officers approving at the same moment move the batch forward exactly once', async () => {
    const id = await createSubmittedBatch(5);
    const [dev, meera] = await Promise.all([tokenFor('dev'), tokenFor('meera')]);

    const [a, b] = await Promise.all([
      request(app).post(`/api/batches/${id}/approve`).set(auth(dev)),
      request(app).post(`/api/batches/${id}/approve`).set(auth(meera)),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    const batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
    expect(batch.status).toBe('STATE_REVIEW');
    expect(await movesTo(id, 'STATE_REVIEW')).toBe(1);
  });

  it('the same officer clicking twice at once counts as one approval', async () => {
    const id = await createSubmittedBatch(5);
    const dev = await tokenFor('dev');
    const results = await Promise.all([
      request(app).post(`/api/batches/${id}/approve`).set(auth(dev)),
      request(app).post(`/api/batches/${id}/approve`).set(auth(dev)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.approval.count({ where: { batchId: id } })).toBe(1);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id } })).status).toBe('DISTRICT_REVIEW');
  });

  it('one officer is not enough at district level', async () => {
    const id = await createSubmittedBatch(5);
    expect((await approve('dev', id)).status).toBe(200);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id } })).status).toBe('DISTRICT_REVIEW');
  });

  it('big batches go to the quality team before the state office', async () => {
    const id = await createSubmittedBatch(51);
    await approve('dev', id);
    await approve('meera', id);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id } })).status).toBe('QUALITY_REVIEW');
    expect((await approve('neha', id)).status).toBe(200);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id } })).status).toBe('STATE_REVIEW');
    expect((await approve('farah', id)).status).toBe(200);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id } })).status).toBe('APPROVED');
  });

  it('nobody can act at a step that is not theirs', async () => {
    const id = await createSubmittedBatch(5);
    expect((await approve('anika', id)).status).toBe(403); // centre
    expect((await approve('ravi', id)).status).toBe(403); // officer from another district
    expect((await approve('neha', id)).status).toBe(403); // quality team, wrong stage
    expect((await approve('farah', id)).status).toBe(403); // state office, wrong stage

    await approve('dev', id);
    await approve('meera', id); // now at STATE_REVIEW
    expect((await approve('kabir', id)).status).toBe(403); // district officer at the state step
  });

  it('a sent-back batch starts again: approvals from the old round no longer count', async () => {
    const id = await createSubmittedBatch(3);
    await approve('dev', id);
    const kabir = await tokenFor('kabir');
    await request(app).post(`/api/batches/${id}/send-back`).set(auth(kabir)).send({ reason: 'Row 2 has the wrong course' }).expect(200);

    const anika = await tokenFor('anika');
    await request(app).put(`/api/batches/${id}/candidates`).set(auth(anika)).set('Content-Type', 'text/csv').send(csvFor(3)).expect(200);
    await request(app).post(`/api/batches/${id}/submit`).set(auth(anika)).expect(200);

    // With Dev's old approval this would make 2. But it is a new round, so it is only 1.
    await approve('meera', id);
    let batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
    expect(batch.round).toBe(2);
    expect(batch.status).toBe('DISTRICT_REVIEW');

    await approve('dev', id); // Dev must approve again
    batch = await prisma.batch.findUniqueOrThrow({ where: { id } });
    expect(batch.status).toBe('STATE_REVIEW');
  });

  it('an officer can withdraw their approval while the batch is still at district', async () => {
    const id = await createSubmittedBatch(3);
    await approve('dev', id);
    const dev = await tokenFor('dev');
    await request(app).post(`/api/batches/${id}/withdraw`).set(auth(dev)).expect(200);
    expect(await prisma.approval.count({ where: { batchId: id } })).toBe(0);
  });

  it('sending back needs a reason', async () => {
    const id = await createSubmittedBatch(3);
    const dev = await tokenFor('dev');
    await request(app).post(`/api/batches/${id}/send-back`).set(auth(dev)).send({ reason: '' }).expect(400);
  });

  it('every decision is recorded with who made it and when', async () => {
    const id = await createApprovedBatch(3);
    const logs = await prisma.auditLog.findMany({ where: { batchId: id } });
    const humanActions = logs.filter((l) => l.actorRole !== 'SYSTEM');
    expect(humanActions.length).toBeGreaterThanOrEqual(6); // created, uploaded, submitted, 3+ approvals
    for (const log of humanActions) {
      expect(log.actorId).toBeTruthy();
      expect(log.createdAt).toBeInstanceOf(Date);
    }
    const approvers = logs.filter((l) => l.action === 'batch.approval_given').map((l) => l.actorId);
    expect(approvers).toEqual(expect.arrayContaining(['dev', 'meera', 'farah']));
  });
});

// STEP 7: the "sweep" job. Runs every 30 seconds in the worker.
//   a) escalate batches that have waited too long with nobody acting on them
//   b) safety net: re-queue any approved candidate who still has no delivered certificate
//      (covers: Redis was down at approval time, a job ran out of retries, a worker crashed)
import { audit } from '../audit';
import { config } from '../config';
import { enqueueIssue, prisma, publishLive } from '../infra';
import { REVIEW_STATUSES } from './workflow';

export async function runSweep(now = new Date()) {
  const escalated = await escalateStuckBatches(now);
  const requeued = await requeueUndelivered();
  return { escalated, requeued };
}

export async function escalateStuckBatches(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.stuckAfterSeconds * 1000);
  const stuck = await prisma.batch.findMany({
    where: { status: { in: REVIEW_STATUSES }, lastActionAt: { lt: cutoff }, escalatedAt: null },
    include: { centre: true },
  });

  let count = 0;
  for (const b of stuck) {
    const claimed = await prisma.$transaction(async (tx) => {
      // "Claim" the batch: only one sweep (even with many workers running) can set escalatedAt.
      const { count: won } = await tx.batch.updateMany({
        where: { id: b.id, status: b.status, escalatedAt: null },
        data: { escalatedAt: now },
      });
      if (won === 0) return false;
      const minutes = Math.max(1, Math.round((now.getTime() - b.lastActionAt.getTime()) / 60000));
      const stage = b.status.replace('_', ' ').toLowerCase();
      await tx.notification.create({
        data: {
          role: 'STATE',
          batchId: b.id,
          message: `"${b.name}" from ${b.centre.name} has waited ${minutes} min at ${stage} with no action.`,
        },
      });
      await audit(tx, { actor: null, action: 'batch.escalated', entityType: 'batch', entityId: b.id, batchId: b.id, details: { status: b.status, waitingMinutes: minutes } });
      return true;
    });
    if (claimed) {
      count++;
      await publishLive({ type: 'batch.escalated', batchId: b.id });
    }
  }
  return count;
}

export async function requeueUndelivered(): Promise<number> {
  const pending = await prisma.candidate.findMany({
    where: {
      batch: { status: 'APPROVED' },
      OR: [{ certificate: { is: null } }, { certificate: { is: { status: 'VALID', delivery: { not: 'SENT' } } } }],
    },
    select: { id: true },
    take: 1000,
  });
  // Same job ids as the original jobs, so anything already waiting in the queue is not added twice.
  await enqueueIssue(pending.map((c) => c.id));
  return pending.length;
}

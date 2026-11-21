// STEP 4: the approval flow (the core of the project).
//
//   DRAFT -> DISTRICT_REVIEW -> (QUALITY_REVIEW if > 50 candidates) -> STATE_REVIEW -> APPROVED
//   any review stage -> SENT_BACK (centre fixes and resubmits) or REJECTED (final)
//
// Every action runs inside withBatchLock: a database transaction that locks the batch row.
// So if two officers click "approve" at the same moment, the second waits for the first.
import type { BatchStatus, Prisma, Stage } from '@prisma/client';
import { audit } from '../audit';
import type { Actor } from '../auth';
import { config } from '../config';
import { HttpError } from '../errors';
import { enqueueIssue, logger, prisma, publishLive } from '../infra';

export const REVIEW_STATUSES: BatchStatus[] = ['DISTRICT_REVIEW', 'QUALITY_REVIEW', 'STATE_REVIEW'];

const STAGE_FOR_STATUS: Partial<Record<BatchStatus, Stage>> = {
  DISTRICT_REVIEW: 'DISTRICT',
  QUALITY_REVIEW: 'QUALITY',
  STATE_REVIEW: 'STATE',
};

export function stageFor(status: BatchStatus): Stage | undefined {
  return STAGE_FOR_STATUS[status];
}

export type LockedBatch = {
  id: string;
  status: BatchStatus;
  round: number;
  centreId: string;
  districtId: string;
  candidateCount: number;
};

export async function withBatchLock<T>(
  batchId: string,
  fn: (tx: Prisma.TransactionClient, batch: LockedBatch) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      // FOR UPDATE = lock this row until the transaction ends. Others wait in line.
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE id = ${batchId} FOR UPDATE`;
      if (locked.length === 0) throw new HttpError(404, 'Batch not found');
      const b = await tx.batch.findUniqueOrThrow({
        where: { id: batchId },
        include: { centre: true, _count: { select: { candidates: true } } },
      });
      return fn(tx, {
        id: b.id,
        status: b.status,
        round: b.round,
        centreId: b.centreId,
        districtId: b.centre.districtId,
        candidateCount: b._count.candidates,
      });
    },
    { timeout: 15000 },
  );
}

// Is it this person's turn to review the batch?
export function canReview(user: Actor, batch: { status: BatchStatus; districtId: string }): boolean {
  switch (batch.status) {
    case 'DISTRICT_REVIEW':
      return user.role === 'OFFICER' && user.districtId === batch.districtId;
    case 'QUALITY_REVIEW':
      return user.role === 'QUALITY';
    case 'STATE_REVIEW':
      return user.role === 'STATE';
    default:
      return false;
  }
}

// The state office deals with anything that goes wrong, so it may send back or reject at any review stage.
export function canSendBack(user: Actor, batch: { status: BatchStatus; districtId: string }): boolean {
  return canReview(user, batch) || (user.role === 'STATE' && REVIEW_STATUSES.includes(batch.status));
}

async function moveTo(
  tx: Prisma.TransactionClient,
  batch: LockedBatch,
  to: BatchStatus,
  actor: Actor,
  opts: { reason?: string; newRound?: boolean } = {},
) {
  // Second safety net: only update if the status is still the one we read.
  const { count } = await tx.batch.updateMany({
    where: { id: batch.id, status: batch.status },
    data: {
      status: to,
      lastActionAt: new Date(),
      escalatedAt: null,
      ...(opts.reason !== undefined ? { lastReason: opts.reason } : {}),
      ...(opts.newRound ? { round: { increment: 1 }, lastReason: null } : {}),
    },
  });
  if (count !== 1) throw new HttpError(409, 'This batch was just changed by someone else. Please refresh.');
  await audit(tx, {
    actor,
    action: 'batch.moved',
    entityType: 'batch',
    entityId: batch.id,
    batchId: batch.id,
    details: { from: batch.status, to, ...(opts.reason ? { reason: opts.reason } : {}) },
  });
}

async function touch(tx: Prisma.TransactionClient, batchId: string) {
  // Any action resets the "stuck" timer.
  await tx.batch.update({ where: { id: batchId }, data: { lastActionAt: new Date() } });
}

export async function submitBatch(actor: Actor, batchId: string) {
  await withBatchLock(batchId, async (tx, b) => {
    if (actor.role !== 'CENTRE' || actor.centreId !== b.centreId) {
      throw new HttpError(403, 'Only the centre that owns this batch can submit it');
    }
    if (b.status !== 'DRAFT' && b.status !== 'SENT_BACK') {
      throw new HttpError(409, `A batch that is ${b.status} cannot be submitted`);
    }
    if (b.candidateCount === 0) throw new HttpError(400, 'Upload candidates before submitting');
    // DECISION: a resubmitted batch starts a new round. Approvals from the old round no longer count,
    // because they were given for different data.
    await moveTo(tx, b, 'DISTRICT_REVIEW', actor, { newRound: b.status === 'SENT_BACK' });
  });
  await publishLive({ type: 'batch.updated', batchId });
}

export async function approveBatch(actor: Actor, batchId: string) {
  const { finalApproval } = await withBatchLock(batchId, async (tx, b) => {
    const stage = stageFor(b.status);
    if (!stage) throw new HttpError(409, `A batch that is ${b.status} cannot be approved`);
    if (!canReview(actor, b)) throw new HttpError(403, 'This step is not yours');

    const already = await tx.approval.findFirst({ where: { batchId: b.id, userId: actor.id, stage, round: b.round } });
    if (already) throw new HttpError(409, 'You have already approved this batch');
    await tx.approval.create({ data: { batchId: b.id, userId: actor.id, stage, round: b.round } });
    await audit(tx, { actor, action: 'batch.approval_given', entityType: 'batch', entityId: b.id, batchId: b.id, details: { stage, round: b.round } });
    await touch(tx, b.id);

    if (stage === 'DISTRICT') {
      const approvals = await tx.approval.count({ where: { batchId: b.id, stage: 'DISTRICT', round: b.round } });
      if (approvals < config.districtApprovalsNeeded) return { finalApproval: false };
      const next: BatchStatus = b.candidateCount > config.bigBatchSize ? 'QUALITY_REVIEW' : 'STATE_REVIEW';
      await moveTo(tx, b, next, actor);
      return { finalApproval: false };
    }
    if (stage === 'QUALITY') {
      await moveTo(tx, b, 'STATE_REVIEW', actor);
      return { finalApproval: false };
    }
    await moveTo(tx, b, 'APPROVED', actor);
    return { finalApproval: true };
  });

  if (finalApproval) {
    // Slow work (PDFs, WhatsApp) goes to the queue. The officer gets an answer right away.
    try {
      const candidates = await prisma.candidate.findMany({ where: { batchId }, select: { id: true } });
      await enqueueIssue(candidates.map((c) => c.id));
    } catch (err) {
      // If Redis is down right now, the sweep job will queue these later. The approval is already saved.
      logger.error({ err, batchId }, 'could not queue certificates; sweep job will retry');
    }
  }
  await publishLive({ type: 'batch.updated', batchId });
}

export async function withdrawApproval(actor: Actor, batchId: string) {
  await withBatchLock(batchId, async (tx, b) => {
    if (b.status !== 'DISTRICT_REVIEW' || actor.role !== 'OFFICER' || actor.districtId !== b.districtId) {
      throw new HttpError(409, 'You can only withdraw your approval while the batch is still at district review');
    }
    const { count } = await tx.approval.deleteMany({
      where: { batchId: b.id, userId: actor.id, stage: 'DISTRICT', round: b.round },
    });
    if (count === 0) throw new HttpError(404, 'You have not approved this batch');
    await audit(tx, { actor, action: 'batch.approval_withdrawn', entityType: 'batch', entityId: b.id, batchId: b.id, details: { round: b.round } });
    await touch(tx, b.id);
  });
  await publishLive({ type: 'batch.updated', batchId });
}

export async function sendBackBatch(actor: Actor, batchId: string, reason: string) {
  await decide(actor, batchId, 'SENT_BACK', reason);
}

export async function rejectBatch(actor: Actor, batchId: string, reason: string) {
  await decide(actor, batchId, 'REJECTED', reason);
}

async function decide(actor: Actor, batchId: string, to: 'SENT_BACK' | 'REJECTED', reason: string) {
  await withBatchLock(batchId, async (tx, b) => {
    if (!REVIEW_STATUSES.includes(b.status)) throw new HttpError(409, `A batch that is ${b.status} cannot be changed`);
    if (!canSendBack(actor, b)) throw new HttpError(403, 'This step is not yours');
    await moveTo(tx, b, to, actor, { reason });
  });
  await publishLive({ type: 'batch.updated', batchId });
}

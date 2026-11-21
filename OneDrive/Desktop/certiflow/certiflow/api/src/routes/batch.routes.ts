// STEPS 3 + 4: batches, CSV upload, and review actions.
import type { Batch, Centre } from '@prisma/client';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { audit } from '../audit';
import { authenticate, requireRole, type Actor } from '../auth';
import { ah, HttpError } from '../errors';
import { prisma, publishLive } from '../infra';
import { certNumber } from '../services/certificates';
import { parseCandidatesCsv } from '../services/csv';
import {
  approveBatch,
  canReview,
  canSendBack,
  rejectBatch,
  sendBackBatch,
  stageFor,
  submitBatch,
  withBatchLock,
  withdrawApproval,
} from '../services/workflow';

export const batchRoutes = Router();
batchRoutes.use(authenticate);

const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500),
});

function batchId(req: Request): string {
  return z.string().uuid('Invalid batch id').parse(req.params.id);
}

// Who may SEE a batch.
function canSee(user: Actor, batch: Batch & { centre: Centre }): boolean {
  if (user.role === 'CENTRE') return user.centreId === batch.centreId;
  if (user.role === 'OFFICER') return user.districtId === batch.centre.districtId;
  return true; // quality team and state office see everything
}

// List: each person only sees batches they are allowed to see.
batchRoutes.get(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const where =
      user.role === 'CENTRE'
        ? { centreId: user.centreId ?? '__none__' }
        : user.role === 'OFFICER'
          ? { centre: { districtId: user.districtId ?? '__none__' } }
          : {};
    const batches = await prisma.batch.findMany({
      where,
      include: {
        centre: true,
        approvals: { include: { user: { select: { name: true } } } },
        _count: { select: { candidates: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    res.json(
      batches.map((b) => {
        const stage = stageFor(b.status);
        const current = b.approvals.filter((a) => a.round === b.round && a.stage === stage);
        const reviewable = canReview(user, { status: b.status, districtId: b.centre.districtId });
        return {
          id: b.id,
          name: b.name,
          status: b.status,
          round: b.round,
          centre: b.centre.name,
          candidateCount: b._count.candidates,
          approvedBy: current.map((a) => a.user.name),
          waitingForMe: reviewable && !current.some((a) => a.userId === user.id),
          lastReason: b.lastReason,
          lastActionAt: b.lastActionAt,
          escalatedAt: b.escalatedAt,
          updatedAt: b.updatedAt,
        };
      }),
    );
  }),
);

batchRoutes.post(
  '/',
  requireRole('CENTRE'),
  ah(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(3, 'Name must have at least 3 characters').max(120) }).parse(req.body);
    const user = req.user!;
    if (!user.centreId) throw new HttpError(403, 'You are not linked to a centre');
    const batch = await prisma.$transaction(async (tx) => {
      const created = await tx.batch.create({ data: { name, centreId: user.centreId! } });
      await audit(tx, { actor: user, action: 'batch.created', entityType: 'batch', entityId: created.id, batchId: created.id, details: { name } });
      return created;
    });
    await publishLive({ type: 'batch.updated', batchId: batch.id });
    res.status(201).json(batch);
  }),
);

// Detail: candidates, approvals, full timeline, and what this person is allowed to do.
batchRoutes.get(
  '/:id',
  ah(async (req, res) => {
    const user = req.user!;
    const batch = await prisma.batch.findUnique({
      where: { id: batchId(req) },
      include: {
        centre: true,
        candidates: { include: { certificate: true }, orderBy: { name: 'asc' } },
        approvals: { include: { user: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!batch) throw new HttpError(404, 'Batch not found');
    if (!canSee(user, batch)) throw new HttpError(403, 'You cannot see this batch');

    const timeline = await prisma.auditLog.findMany({ where: { batchId: batch.id }, orderBy: { createdAt: 'asc' } });
    const stage = stageFor(batch.status);
    const ref = { status: batch.status, districtId: batch.centre.districtId };
    const isOwner = user.role === 'CENTRE' && user.centreId === batch.centreId;
    const editable = isOwner && (batch.status === 'DRAFT' || batch.status === 'SENT_BACK');
    const approvedByMe = batch.approvals.some((a) => a.userId === user.id && a.round === batch.round && a.stage === stage);

    res.json({
      id: batch.id,
      name: batch.name,
      status: batch.status,
      round: batch.round,
      lastReason: batch.lastReason,
      lastActionAt: batch.lastActionAt,
      escalatedAt: batch.escalatedAt,
      centre: batch.centre.name,
      candidates: batch.candidates.map((c) => ({  
        id: c.id,
        name: c.name,
        phone: c.phone,
        course: c.course,
        grade: c.grade,
        certificate: c.certificate && {
          id: c.certificate.id,
          number: certNumber(c.certificate.seq),
          status: c.certificate.status,
          delivery: c.certificate.delivery,
          deliveryAttempts: c.certificate.deliveryAttempts,
        },
      })),
      approvals: batch.approvals
        .filter((a) => a.round === batch.round)
        .map((a) => ({ by: a.user.name, stage: a.stage, at: a.createdAt })),
      timeline: timeline.map((t) => ({ id: t.id, at: t.createdAt, by: t.actorName, role: t.actorRole, action: t.action, details: t.details })),
      permissions: {
        canEdit: editable,
        canSubmit: editable && batch.candidates.length > 0,
        canApprove: canReview(user, ref) && !approvedByMe,
        canWithdraw: batch.status === 'DISTRICT_REVIEW' && approvedByMe,
        canSendBack: canSendBack(user, ref),
        canRevoke: user.role === 'STATE' && batch.status === 'APPROVED',
      },
    });
  }),
);

// Upload candidates. The body is the CSV text. All-or-nothing.
batchRoutes.put(
  '/:id/candidates',
  requireRole('CENTRE'),
  express.text({ type: ['text/csv', 'text/plain'], limit: '1mb' }),
  ah(async (req, res) => {
    const user = req.user!;
    const id = batchId(req);
    if (typeof req.body !== 'string' || req.body.trim() === '') {
      throw new HttpError(400, 'Send the CSV file as text/csv');
    }
    const { rows, errors } = parseCandidatesCsv(req.body);
    if (errors.length > 0) {
      throw new HttpError(422, `The file has ${errors.length} problem(s). Nothing was saved.`, errors);
    }

    await withBatchLock(id, async (tx, b) => {
      if (user.centreId !== b.centreId) throw new HttpError(403, 'This is not your batch');
      if (b.status !== 'DRAFT' && b.status !== 'SENT_BACK') {
        throw new HttpError(409, 'Candidates can only be changed while the batch is a draft or sent back');
      }
      // Replace the whole list in one transaction: either all rows are saved or none are.
      await tx.candidate.deleteMany({ where: { batchId: id } });
      await tx.candidate.createMany({ data: rows.map((r) => ({ ...r, batchId: id })) });
      await tx.batch.update({ where: { id }, data: { lastActionAt: new Date() } });
      await audit(tx, { actor: user, action: 'batch.candidates_uploaded', entityType: 'batch', entityId: id, batchId: id, details: { count: rows.length } });
    });
    await publishLive({ type: 'batch.updated', batchId: id });
    res.json({ saved: rows.length });
  }),
);

batchRoutes.post('/:id/submit', ah(async (req, res) => {
  await submitBatch(req.user!, batchId(req));
  res.json({ ok: true });
}));

batchRoutes.post('/:id/approve', ah(async (req, res) => {
  await approveBatch(req.user!, batchId(req));
  res.json({ ok: true });
}));

batchRoutes.post('/:id/withdraw', ah(async (req, res) => {
  await withdrawApproval(req.user!, batchId(req));
  res.json({ ok: true });
}));

batchRoutes.post('/:id/send-back', ah(async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  await sendBackBatch(req.user!, batchId(req), reason);
  res.json({ ok: true });
}));

batchRoutes.post('/:id/reject', ah(async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  await rejectBatch(req.user!, batchId(req), reason);
  res.json({ ok: true });
}));

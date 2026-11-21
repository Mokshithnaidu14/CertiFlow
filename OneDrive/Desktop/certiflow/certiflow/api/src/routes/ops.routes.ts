// STEPS 6 + 7: state office tools: cancel a certificate, see escalations, see the queue,
// and trace the full history of any batch or certificate.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../auth';
import { ah } from '../errors';
import { certificateQueue, prisma } from '../infra';
import { revokeCertificate } from '../services/certificates';

export const opsRoutes = Router();
opsRoutes.use(authenticate);

opsRoutes.post(
  '/certificates/:id/revoke',
  requireRole('STATE'),
  ah(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { reason } = z.object({ reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500) }).parse(req.body);
    await revokeCertificate(req.user!, id, reason);
    res.json({ ok: true });
  }),
);

opsRoutes.get(
  '/notifications',
  requireRole('STATE'),
  ah(async (_req, res) => {
    const notes = await prisma.notification.findMany({ where: { role: 'STATE' }, orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(notes);
  }),
);

opsRoutes.get(
  '/ops/queue',
  requireRole('STATE'),
  ah(async (_req, res) => {
    const counts = await certificateQueue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    const undelivered = await prisma.certificate.count({ where: { status: 'VALID', delivery: { not: 'SENT' } } });
    res.json({ ...counts, undelivered });
  }),
);

// Observability: everything that happened to a batch or a certificate, in order.
opsRoutes.get(
  '/trace/:entityId',
  requireRole('STATE'),
  ah(async (req, res) => {
    const id = z.string().uuid().parse(req.params.entityId);
    const events = await prisma.auditLog.findMany({
      where: { OR: [{ entityId: id }, { batchId: id }] },
      orderBy: { createdAt: 'asc' },
    });
    res.json(events);
  }),
);

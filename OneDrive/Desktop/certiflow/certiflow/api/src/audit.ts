// Every decision is recorded: who did it, what they did, and when.
// Always called inside the same transaction as the change, so a change can't happen without its record.
import type { Prisma } from '@prisma/client';
import type { Actor } from './auth';
import { logger } from './infra';

export async function audit(
  db: Prisma.TransactionClient,
  entry: {
    actor: Actor | null; // null = done by the system (worker, sweep job)
    action: string;
    entityType: 'batch' | 'certificate';
    entityId: string;
    batchId?: string;
    details?: Prisma.InputJsonValue;
  },
) {
  await db.auditLog.create({
    data: {
      actorId: entry.actor?.id ?? null,
      actorName: entry.actor?.name ?? 'system',
      actorRole: entry.actor?.role ?? 'SYSTEM',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      batchId: entry.batchId ?? null,
      details: entry.details,
    },
  });
  logger.info(
    { action: entry.action, entityId: entry.entityId, batchId: entry.batchId, actor: entry.actor?.id ?? 'system' },
    entry.action,
  );
}

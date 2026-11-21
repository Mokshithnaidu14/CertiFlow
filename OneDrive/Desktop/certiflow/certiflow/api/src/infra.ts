// Shared connections: database, Redis, job queue, logger, live updates.
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { config } from './config';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

export const prisma = new PrismaClient();

// Turn redis://host:port/db into options that both ioredis and BullMQ accept.
export function redisOptions() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
    password: url.password || undefined,
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

// Normal Redis commands: cache, rate limit, publishing live updates.
export const redis = new Redis(redisOptions());

// STEP 5: the job queue. "issue" = make + send one certificate. "sweep" = periodic safety checks.
export const certificateQueue = new Queue('certificates', { connection: redisOptions() });

export async function enqueueIssue(candidateIds: string[]) {
  if (candidateIds.length === 0) return;
  await certificateQueue.addBulk(
    candidateIds.map((candidateId) => ({
      name: 'issue',
      data: { candidateId },
      opts: {
        jobId: `issue-${candidateId}`, // the same candidate can't be queued twice at the same time
        attempts: 6, // retry up to 6 times: 2s, 4s, 8s, 16s, 32s
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true, // the sweep job re-queues anything that still isn't delivered
      },
    })),
  );
}

// STEP 7: live updates. Any API instance or worker publishes; every API instance forwards to its browsers.
export const LIVE_CHANNEL = 'certiflow:live';

export async function publishLive(event: { type: string; batchId?: string }) {
  try {
    await redis.publish(LIVE_CHANNEL, JSON.stringify({ ...event, at: new Date().toISOString() }));
  } catch (err) {
    logger.warn({ err }, 'live update not sent'); // live updates are nice-to-have; never fail a request for them
  }
}

export async function closeAll() {
  await certificateQueue.close();
  await redis.quit();
  await prisma.$disconnect();
}

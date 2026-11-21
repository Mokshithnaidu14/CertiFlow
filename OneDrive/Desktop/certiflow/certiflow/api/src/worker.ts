// STEP 5 + 7: the worker. Takes jobs from the queue so slow work never holds up a user.
// You can run many workers (docker compose up --scale worker=3); BullMQ gives each job to one of them.
// If a worker dies mid-job, BullMQ notices ("stalled job") and hands the job to another worker.
import { Worker } from 'bullmq';
import { certificateQueue, closeAll, logger, redisOptions } from './infra';
import { issueCertificate, markDeliveryFailed } from './services/issue';
import { runSweep } from './services/sweep';

const worker = new Worker(
  'certificates',
  async (job) => {
    if (job.name === 'issue') return issueCertificate(job.data.candidateId);
    if (job.name === 'sweep') return runSweep();
    logger.warn({ name: job.name }, 'unknown job');
  },
  { connection: redisOptions(), concurrency: 10 },
);

worker.on('completed', (job, result) => {
  if (job.name === 'issue') logger.info({ jobId: job.id, candidateId: job.data.candidateId, result }, 'certificate job done');
});

worker.on('failed', (job, err) => {
  if (!job) return;
  logger.warn({ jobId: job.id, attempt: job.attemptsMade, err: err.message }, 'job failed');
  const outOfRetries = job.attemptsMade >= (job.opts.attempts ?? 1);
  if (job.name === 'issue' && outOfRetries) {
    markDeliveryFailed(job.data.candidateId, err.message).catch((e) => logger.error({ err: e }, 'markDeliveryFailed'));
  }
});

// One repeating sweep job for the whole system. BullMQ de-duplicates it, even with many workers.
certificateQueue
  .add('sweep', {}, { repeat: { every: 30_000 }, removeOnComplete: true, removeOnFail: true })
  .then(() => logger.info('worker started; sweep runs every 30s'))
  .catch((err) => logger.error({ err }, 'could not schedule sweep'));

async function shutdown() {
  logger.info('worker shutting down (finishing current jobs)');
  await worker.close();
  await closeAll().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

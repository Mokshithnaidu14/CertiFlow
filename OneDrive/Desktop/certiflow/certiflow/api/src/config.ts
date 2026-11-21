// All settings come from environment variables (see docker-compose.yml).
// They are read when used (getters), so tests can change them.
export const config = {
  get port() { return Number(process.env.PORT ?? 3000); },
  get jwtSecret() { return process.env.JWT_SECRET ?? 'dev-secret-change-me'; },
  get redisUrl() { return process.env.REDIS_URL ?? 'redis://localhost:6379/0'; },
  get whatsappUrl() { return process.env.WHATSAPP_URL ?? 'http://localhost:4000'; },
  get whatsappTimeoutMs() { return Number(process.env.WHATSAPP_TIMEOUT_MS ?? 5000); },
  get publicUrl() { return process.env.PUBLIC_URL ?? 'http://localhost:5173'; },
  get filesDir() { return process.env.FILES_DIR ?? './data/certificates'; },
  // A batch with no action for this long is "stuck" and gets escalated (2 min in the demo, 48 h in real life).
  get stuckAfterSeconds() { return Number(process.env.STUCK_AFTER_SECONDS ?? 120); },
  // Batches with more candidates than this go to the quality team.
  get bigBatchSize() { return Number(process.env.BIG_BATCH_SIZE ?? 50); },
  // How many different district officers must approve.
  get districtApprovalsNeeded() { return 2; },
};

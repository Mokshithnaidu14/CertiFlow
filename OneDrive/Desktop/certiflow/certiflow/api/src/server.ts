// Starts the API. Stateless: no sessions in memory, so you can run as many copies as you like.
import { createApp } from './app';
import { config } from './config';
import { closeAll, logger } from './infra';
import { closeLive } from './routes/public.routes';

const server = createApp().listen(config.port, () => logger.info(`API listening on port ${config.port}`));

async function shutdown() {
  logger.info('shutting down');
  server.close();
  await closeLive().catch(() => undefined);
  await closeAll().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

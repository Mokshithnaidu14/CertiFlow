// The Express app. Kept separate from server.ts so tests can use it without opening a port.
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import pinoHttp from 'pino-http';
import { config } from './config';
import { errorHandler, HttpError } from './errors';
import { logger } from './infra';
import { authRoutes } from './routes/auth.routes';
import { batchRoutes } from './routes/batch.routes';
import { opsRoutes } from './routes/ops.routes';
import { publicRoutes } from './routes/public.routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.publicUrl }));
  // Every request gets an id (or keeps the one it came with). It appears in every log line for that request.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' || (req.url ?? '').startsWith('/api/live') },
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api', publicRoutes);
  app.use('/api/batches', batchRoutes);
  app.use('/api', opsRoutes);

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use(errorHandler);
  return app;
}

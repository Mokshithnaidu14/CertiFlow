// STEP 6 + 7: things that work WITHOUT the normal login header:
//   - public certificate check (employers never log in)
//   - certificate download (the link sent on WhatsApp carries a long secret token)
//   - live updates stream (token is passed in the URL, because browsers' EventSource can't send headers)
import { Router, type Response } from 'express';
import { Redis } from 'ioredis';
import path from 'node:path';
import { verifyToken } from '../auth';
import { ah, HttpError } from '../errors';
import { LIVE_CHANNEL, logger, prisma, redisOptions } from '../infra';
import { certNumber, rateLimit, verifyCertificate } from '../services/certificates';

export const publicRoutes = Router();

publicRoutes.get(
  '/verify/:number',
  ah(async (req, res) => {
    await rateLimit(req.ip ?? 'unknown', 'verify', 60);
    const number = String(req.params.number).trim().toUpperCase();
    const code = String(req.query.code ?? '').trim().toUpperCase();
    const result = await verifyCertificate(number, code);
    if (!result) {
      return res.status(404).json({ valid: false, message: 'No certificate matches this number and code.' });
    }
    res.json(result);
  }),
);

publicRoutes.get(
  '/certificates/download/:token',
  ah(async (req, res) => {
    await rateLimit(req.ip ?? 'unknown', 'download', 60);
    const token = String(req.params.token);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, 'Not found');
    const cert = await prisma.certificate.findUnique({ where: { downloadToken: token } });
    if (!cert || !cert.pdfPath) throw new HttpError(404, 'Not found');
    if (cert.status !== 'VALID') throw new HttpError(410, 'This certificate has been cancelled');
    res.download(path.resolve(cert.pdfPath), `${certNumber(cert.seq)}.pdf`);
  }),
);

// ---- Live updates (Server-Sent Events) ----
// Each API instance has ONE Redis subscriber and forwards every event to its connected browsers.
// Events only say "batch X changed". The browser then re-fetches through the normal, permission-checked API.
const clients = new Set<Response>();
let subscriber: Redis | null = null;

function ensureSubscriber() {
  if (subscriber) return;
  subscriber = new Redis(redisOptions());
  subscriber.subscribe(LIVE_CHANNEL).catch((err) => logger.error({ err }, 'live subscribe failed'));
  subscriber.on('message', (_channel, message) => {
    for (const res of clients) res.write(`data: ${message}\n\n`);
  });
}

publicRoutes.get('/live', (req, res) => {
  try {
    verifyToken(String(req.query.token ?? ''));
  } catch {
    res.status(401).end();
    return;
  }
  ensureSubscriber();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000); // keeps the connection open
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

export async function closeLive() {
  for (const res of clients) res.end();
  clients.clear();
  if (subscriber) await subscriber.quit();
  subscriber = null;
}

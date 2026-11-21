import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

// Throw this anywhere to send a clean error to the user.
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

// Express 4 does not catch errors from async functions, so we wrap every route.
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

// P2002 = the database refused a duplicate (a unique rule was broken).
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Invalid input',
      details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  if (isUniqueViolation(err)) return res.status(409).json({ error: 'This was already done' });

  req.log?.error({ err }, 'unexpected error');
  res.status(500).json({ error: 'Something went wrong' });
};

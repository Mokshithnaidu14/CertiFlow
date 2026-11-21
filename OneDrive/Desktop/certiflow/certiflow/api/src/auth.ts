// STEP 2: login and roles.
// The server signs a token that says who you are and what your role is.
// If anyone edits the token, the signature no longer matches and it is rejected.
import type { Role } from '@prisma/client';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { HttpError } from './errors';

export type Actor = {
  id: string;
  name: string;
  role: Role;
  districtId: string | null;
  centreId: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: Actor;
    }
  }
}

export function signToken(user: Actor): string {
  return jwt.sign(
    { name: user.name, role: user.role, districtId: user.districtId, centreId: user.centreId },
    config.jwtSecret,
    { subject: user.id, expiresIn: '8h', algorithm: 'HS256' },
  );
}

export function verifyToken(token: string): Actor {
  // algorithms: only accept HS256, so a token with "alg: none" is refused.
  const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  if (!payload.sub) throw new Error('token has no subject');
  return {
    id: payload.sub,
    name: payload.name,
    role: payload.role,
    districtId: payload.districtId ?? null,
    centreId: payload.centreId ?? null,
  };
}

export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new HttpError(401, 'Please log in'));
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired login'));
  }
};

// Role comes from the signed token, never from the request body.
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'You are not allowed to do this'));
    }
    next();
  };

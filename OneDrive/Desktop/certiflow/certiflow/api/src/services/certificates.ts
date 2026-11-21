// STEP 6: certificate numbers, codes, public verification and cancelling.
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { audit } from '../audit';
import type { Actor } from '../auth';
import { HttpError } from '../errors';
import { logger, prisma, publishLive, redis } from '../infra';

// seq 42 -> "PSM-000042". The number comes from a database counter, so it is always unique.
export function certNumber(seq: number): string {
  return `PSM-${String(seq).padStart(6, '0')}`;
}

export function parseCertNumber(value: string): number | null {
  const match = /^PSM-(\d{1,10})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

// 8 characters, no look-alikes (no 0/O, 1/I). Printed on the certificate.
// Needed to verify, so nobody can scan through numbers 1, 2, 3... to collect names.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newVerifyCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

// Long random token used in the download link sent on WhatsApp. Impossible to guess.
export function newDownloadToken(): string {
  return randomBytes(32).toString('hex');
}

export function verifyCacheKey(number: string): string {
  return `verify:${number.toUpperCase()}`;
}

export const VERIFY_CACHE_SECONDS = 30;

type PublicRecord = {
  code: string;
  status: 'VALID' | 'REVOKED';
  name: string;
  course: string;
  grade: string;
  centre: string;
  issuedAt: string;
  revokedAt: string | null;
};

function sameCode(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Returns null when the number/code pair doesn't match anything (same answer either way,
// so a stranger learns nothing).
export async function verifyCertificate(number: string, code: string) {
  const seq = parseCertNumber(number);
  if (!seq || !/^[A-Z0-9]{8}$/.test(code)) return null;
  const key = verifyCacheKey(number);

  let record: PublicRecord | null = null;
  const cached = await redis.get(key).catch(() => null); // if Redis is down, just use the database
  if (cached) {
    record = JSON.parse(cached) as PublicRecord;
  } else {
    const cert = await prisma.certificate.findUnique({
      where: { seq },
      include: { candidate: { include: { batch: { include: { centre: true } } } } },
    });
    if (cert) {
      record = {
        code: cert.verifyCode,
        status: cert.status,
        name: cert.candidate.name,
        course: cert.candidate.course,
        grade: cert.candidate.grade,
        centre: cert.candidate.batch.centre.name,
        issuedAt: cert.issuedAt.toISOString(),
        revokedAt: cert.revokedAt?.toISOString() ?? null,
      };
      // Short cache: bursts of lookups don't hit the database.
      await redis.set(key, JSON.stringify(record), 'EX', VERIFY_CACHE_SECONDS).catch(() => undefined);
    }
  }

  if (!record || !sameCode(record.code, code)) return null;
  // Only what an employer needs. Never the phone number.
  return {
    valid: record.status === 'VALID',
    status: record.status,
    number: number.toUpperCase(),
    name: record.name,
    course: record.course,
    grade: record.grade,
    centre: record.centre,
    issuedAt: record.issuedAt,
    revokedAt: record.revokedAt,
  };
}

export async function revokeCertificate(actor: Actor, certificateId: string, reason: string) {
  const cert = await prisma.$transaction(async (tx) => {
    const { count } = await tx.certificate.updateMany({
      where: { id: certificateId, status: 'VALID' },
      data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason },
    });
    if (count === 0) throw new HttpError(409, 'Certificate not found or already cancelled');
    const c = await tx.certificate.findUniqueOrThrow({ where: { id: certificateId }, include: { candidate: true } });
    await audit(tx, {
      actor,
      action: 'certificate.revoked',
      entityType: 'certificate',
      entityId: c.id,
      batchId: c.candidate.batchId,
      details: { number: certNumber(c.seq), reason },
    });
    return c;
  });

  // Throw away the cached "valid" answer right now, so the next check reads the database.
  // (Even if this fails, the cache only lives 30 seconds, so within a minute it's always correct.)
  try {
    await redis.del(verifyCacheKey(certNumber(cert.seq)));
  } catch (err) {
    logger.warn({ err }, 'could not clear verify cache');
  }
  await publishLive({ type: 'certificate.revoked', batchId: cert.candidate.batchId });
  return cert;
}

// Simple rate limit in Redis: N requests per minute per IP. If Redis is down, let requests through.
export async function rateLimit(ip: string, bucket: string, perMinute: number) {
  const key = `rl:${bucket}:${ip}:${Math.floor(Date.now() / 60000)}`;
  let count = 0;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
  } catch {
    return;
  }
  if (count > perMinute) throw new HttpError(429, 'Too many requests. Please wait a minute.');
}

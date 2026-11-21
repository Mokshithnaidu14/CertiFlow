// STEP 5: issue ONE certificate for ONE candidate. Runs in the worker.
//
// This function is safe to run twice, or to crash halfway and run again ("idempotent"):
//   1. create certificate  -> the database allows only one per candidate
//   2. make the PDF        -> same file every time
//   3. send on WhatsApp    -> same idempotency key every time, so the provider delivers once
// That is how 60 approved candidates end up with exactly 60 certificates even when WhatsApp is unreliable.
import path from 'node:path';
import { audit } from '../audit';
import { config } from '../config';
import { isUniqueViolation } from '../errors';
import { logger, prisma, publishLive } from '../infra';
import { certNumber, newDownloadToken, newVerifyCode } from './certificates';
import { renderCertificatePdf } from './pdf';
import { sendWhatsApp } from './whatsapp';

export async function issueCertificate(candidateId: string) {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    include: { batch: { include: { centre: true } }, certificate: true },
  });
  if (!candidate || candidate.batch.status !== 'APPROVED') return { skipped: 'batch not approved' };

  // 1) Create the certificate exactly once.
  let cert = candidate.certificate;
  if (!cert) {
    try {
      cert = await prisma.$transaction(async (tx) => {
        const created = await tx.certificate.create({
          data: { candidateId, verifyCode: newVerifyCode(), downloadToken: newDownloadToken() },
        });
        await audit(tx, {
          actor: null,
          action: 'certificate.created',
          entityType: 'certificate',
          entityId: created.id,
          batchId: candidate.batchId,
          details: { number: certNumber(created.seq), candidate: candidate.name },
        });
        return created;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Another worker created it a moment ago. Use that one.
      cert = await prisma.certificate.findUniqueOrThrow({ where: { candidateId } });
    }
  }
  if (cert.status === 'REVOKED') return { skipped: 'revoked' };

  const certId = cert.id;
  const number = certNumber(cert.seq);
  const verifyUrl = `${config.publicUrl}/?verify=${number}&code=${cert.verifyCode}`;

  // 2) Make the PDF.
  if (!cert.pdfPath) {
    const filePath = path.resolve(config.filesDir, `${certId}.pdf`);
    await renderCertificatePdf(
      {
        name: candidate.name,
        course: candidate.course,
        grade: candidate.grade,
        centre: candidate.batch.centre.name,
        number,
        code: cert.verifyCode,
        issuedOn: cert.issuedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
        verifyUrl,
      },
      filePath,
    );
    cert = await prisma.certificate.update({ where: { id: certId }, data: { pdfPath: filePath } });
  }

  // 3) Send on WhatsApp. If this throws, the queue retries the whole job later; steps 1 and 2 are skipped then.
  if (cert.delivery !== 'SENT') {
    await prisma.certificate.update({ where: { id: certId }, data: { deliveryAttempts: { increment: 1 } } });
    try {
      await sendWhatsApp({
        to: candidate.phone,
        idempotencyKey: certId,
        text: `Congratulations ${candidate.name}! Your Pragati Skills Mission certificate ${number} for ${candidate.course} is ready.`,
        link: `${config.publicUrl}/api/certificates/download/${cert.downloadToken}`,
      });
    } catch (err) {
      await prisma.certificate.update({ where: { id: certId }, data: { lastError: (err as Error).message.slice(0, 300) } });
      throw err;
    }
    const marked = await prisma.$transaction(async (tx) => {
      const { count } = await tx.certificate.updateMany({
        where: { id: certId, delivery: { not: 'SENT' } },
        data: { delivery: 'SENT', sentAt: new Date(), lastError: null },
      });
      if (count === 1) {
        await audit(tx, { actor: null, action: 'certificate.delivered', entityType: 'certificate', entityId: certId, batchId: candidate.batchId, details: { number } });
      }
      return count === 1;
    });
    if (marked) await publishLive({ type: 'certificate.delivered', batchId: candidate.batchId });
  }

  return { number };
}

// Called when a job has used up all its retries (e.g. WhatsApp is down).
// The sweep job will try again later; this just makes the problem visible.
export async function markDeliveryFailed(candidateId: string, error: string) {
  const cert = await prisma.certificate.findUnique({ where: { candidateId }, include: { candidate: true } });
  if (!cert || cert.delivery === 'SENT') return;
  await prisma.$transaction(async (tx) => {
    await tx.certificate.update({ where: { id: cert.id }, data: { delivery: 'FAILED', lastError: error.slice(0, 300) } });
    await audit(tx, { actor: null, action: 'certificate.delivery_failed', entityType: 'certificate', entityId: cert.id, batchId: cert.candidate.batchId, details: { error: error.slice(0, 300), attempts: cert.deliveryAttempts } });
  });
  logger.warn({ candidateId, error }, 'delivery failed after all retries; sweep job will retry');
  await publishLive({ type: 'certificate.failed', batchId: cert.candidate.batchId });
}

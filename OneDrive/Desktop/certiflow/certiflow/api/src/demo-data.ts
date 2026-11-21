// STEP 1: the demo people from the brief, plus one sample batch so reviewers can try things at once.
import type { Prisma, PrismaClient } from '@prisma/client';

const people: Prisma.UserUncheckedCreateInput[] = [
  { id: 'anika', name: 'Anika', role: 'CENTRE', centreId: 'centre-sunrise' },
  { id: 'dev', name: 'Dev', role: 'OFFICER', districtId: 'district-north' },
  { id: 'meera', name: 'Meera', role: 'OFFICER', districtId: 'district-north' },
  { id: 'kabir', name: 'Kabir', role: 'OFFICER', districtId: 'district-north' },
  { id: 'neha', name: 'Neha', role: 'QUALITY' },
  { id: 'farah', name: 'Farah', role: 'STATE' },
];

const sampleCandidates = [
  { name: 'Asha Reddy', phone: '9000000101', course: 'Electrician', grade: 'A' },
  { name: 'Ravi Teja', phone: '9000000102', course: 'Electrician', grade: 'B' },
  { name: 'Lakshmi Prasad', phone: '9000000103', course: 'Electrician', grade: 'A' },
  { name: 'Kiran Kumar', phone: '9000000104', course: 'Electrician', grade: 'C' },
  { name: 'Divya Sri', phone: '9000000105', course: 'Electrician', grade: 'B' },
];

export async function seedDemoData(prisma: PrismaClient, opts: { withSampleBatch?: boolean } = {}) {
  const withSampleBatch = opts.withSampleBatch ?? true;

  await prisma.district.upsert({
    where: { id: 'district-north' },
    update: {},
    create: { id: 'district-north', name: 'North District' },
  });
  await prisma.centre.upsert({
    where: { id: 'centre-sunrise' },
    update: {},
    create: { id: 'centre-sunrise', name: 'Sunrise Skills Centre', districtId: 'district-north' },
  });
  for (const person of people) {
    await prisma.user.upsert({ where: { id: person.id }, update: {}, create: person });
  }

  if (withSampleBatch && (await prisma.batch.count()) === 0) {
    const batch = await prisma.batch.create({
      data: {
        name: 'Electrician - Nov 2026 (sample)',
        centreId: 'centre-sunrise',
        candidates: { create: sampleCandidates },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorName: 'system',
        actorRole: 'SYSTEM',
        action: 'batch.created',
        entityType: 'batch',
        entityId: batch.id,
        batchId: batch.id,
        details: { note: 'sample data', candidates: sampleCandidates.length },
      },
    });
  }
}

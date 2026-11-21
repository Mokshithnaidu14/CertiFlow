// STEP 1: demo data. Runs every time the API starts; safe to run again (it uses upsert).
import { PrismaClient } from '@prisma/client';
import { seedDemoData } from '../src/demo-data';

const prisma = new PrismaClient();

seedDemoData(prisma)
  .then(() => console.log('Demo data ready'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

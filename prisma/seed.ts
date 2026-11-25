/**
 * Fills the database with what every installation needs (`npm run db:seed`, safe to repeat):
 *   1. the list of modules the super admin can switch on for organizations,
 *   2. the first super admin account (from SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** The modules of EduPlatform v1 (docs/05-module-catalog.md). */
const MODULES = [
  {
    key: 'academic',
    name: 'Academic',
    description: 'Academic years, year / group / section structure, subjects, holidays',
    dependsOn: [],
    sortOrder: 1,
  },
  {
    key: 'students',
    name: 'Students',
    description: 'Admissions, student profiles, guardians, documents, promotion',
    dependsOn: ['academic'],
    sortOrder: 2,
  },
  {
    key: 'attendance',
    name: 'Attendance',
    description: 'Manual and biometric attendance, corrections, reports',
    dependsOn: ['academic', 'students'],
    sortOrder: 3,
  },
  {
    key: 'portal',
    name: 'Parent and student portal',
    description: 'Parents and students see profile and attendance',
    dependsOn: ['students'],
    sortOrder: 4,
  },
  {
    key: 'imports',
    name: 'Data import',
    description: 'Import students and other data from CSV / Excel files',
    dependsOn: ['academic', 'students'],
    sortOrder: 5,
  },
  {
    key: 'evaluation',
    name: 'Evaluation',
    description: 'Exam types, exams with subjects and marks, marks upload, results',
    dependsOn: ['academic', 'students'],
    sortOrder: 6,
  },
];

async function main() {
  for (const module of MODULES) {
    await prisma.module.upsert({ where: { key: module.key }, update: module, create: module });
  }
  console.log(`Modules: ${MODULES.map((m) => m.key).join(', ')}`);

  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('No SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD: no super admin created.');
    return;
  }
  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log(`Super admin ${email} already exists (password unchanged).`);
    return;
  }
  await prisma.superAdmin.create({
    data: { name: 'Super Admin', email, passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`Super admin created: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

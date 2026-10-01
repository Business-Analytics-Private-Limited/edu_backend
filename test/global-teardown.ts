/**
 * Runs once after all end-to-end tests: deletes the temporary database made by global-setup.ts
 * and the run's temporary folder of uploaded files.
 */
import { rm } from 'node:fs/promises';
import { Client } from 'pg';
import { testStorageDir } from './setup-env';

export default async function globalTeardown() {
  const name = process.env.TEST_DATABASE_NAME;
  // Only ever delete a database this test run created.
  if (!name?.startsWith('eduplatform_test_')) return;

  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${name} with (force)`);
  } finally {
    await admin.end();
  }
  await rm(testStorageDir(name), { recursive: true, force: true });
}

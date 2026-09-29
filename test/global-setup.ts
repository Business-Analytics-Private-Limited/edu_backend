/**
 * Runs once before all end-to-end tests:
 *   1. creates a NEW, empty database just for this test run (e.g. eduplatform_test_1759123456789),
 *   2. applies every migration and runs the seed (modules + the test super admin),
 *   3. tells the tests to use it (TEST_DATABASE_NAME).
 * global-teardown.ts deletes that database afterwards. Existing databases are never touched.
 *
 * Needs DATABASE_ADMIN_URL in .env (a PostgreSQL superuser, only for creating the database).
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { Client } from 'pg';
import { testDatabaseUrls } from './setup-env';

export default async function globalSetup() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is missing in .env (see .env.example)');

  const name = `eduplatform_test_${Date.now()}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`create database ${name} owner edu_owner`);
    await admin.query(`grant connect on database ${name} to edu_app`);
  } finally {
    await admin.end();
  }

  process.env.TEST_DATABASE_NAME = name; // read by setup-env.ts in the test workers
  const env = { ...process.env, ...testDatabaseUrls(name) };
  const cwd = join(__dirname, '..');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'ignore' });
  execSync('npx prisma db seed', { cwd, env, stdio: 'ignore' });
}

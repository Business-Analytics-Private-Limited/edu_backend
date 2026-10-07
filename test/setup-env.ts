/**
 * Runs before the tests: loads .env, then points the app at this run's temporary test database
 * (created by global-setup.ts), so tests never touch your development data.
 */
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** Connection URLs for a database name, keeping the host, port, users and passwords. */
export function testDatabaseUrls(databaseName: string) {
  const withName = (url: string | undefined, fallback: string) => {
    const parsed = new URL(url ?? fallback);
    parsed.pathname = `/${databaseName}`;
    return parsed.toString();
  };
  return {
    DATABASE_URL: withName(
      process.env.DATABASE_URL,
      'postgres://edu_app:edu_app@localhost:5432/eduplatform',
    ),
    DIRECT_DATABASE_URL: withName(
      process.env.DIRECT_DATABASE_URL,
      'postgres://edu_owner:edu_owner@localhost:5432/eduplatform',
    ),
  };
}

process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough-for-tests';
process.env.SECRETS_KEY ??= 'test-secrets-key-that-is-long-enough-for-tests';
process.env.SEED_SUPER_ADMIN_EMAIL = 'superadmin@test.local';
process.env.SEED_SUPER_ADMIN_PASSWORD = 'SuperAdmin@123';

if (process.env.TEST_DATABASE_NAME) {
  Object.assign(process.env, testDatabaseUrls(process.env.TEST_DATABASE_NAME));
  // Uploaded files of this run go to a temporary folder, deleted afterwards (global-teardown).
  process.env.STORAGE_DIR = testStorageDir(process.env.TEST_DATABASE_NAME);
}

/** The temporary folder for uploaded files of a test run. */
export function testStorageDir(databaseName: string) {
  return join(tmpdir(), `${databaseName}-files`);
}

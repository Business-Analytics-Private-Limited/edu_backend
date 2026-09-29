/**
 * Prepares a PostgreSQL server for local development or tests, without Docker (ADR-0012).
 *
 * Needs a superuser connection (DATABASE_ADMIN_URL), because only a superuser can create
 * roles and databases. It:
 *   1. creates the five database roles if they don't exist (infra/database/roles.sql),
 *   2. creates the database if it doesn't exist, owned by edu_owner,
 *   3. lets the runtime roles connect to it.
 *
 * Everything is safe to run again.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/** Root of the repository, from this file's location: apps/api/src/db (or apps/api/dist/db). */
const repoRoot = join(__dirname, '..', '..', '..', '..');
const ROLES_SQL = join(repoRoot, 'infra', 'database', 'roles.sql');

const DATABASE_NAME = /^[a-z_][a-z0-9_]*$/;
const RUNTIME_ROLES = 'edu_app, edu_platform, edu_relay, edu_gateway';

export async function prepareDatabase(adminUrl: string, databaseName: string): Promise<void> {
  if (!DATABASE_NAME.test(databaseName)) throw new Error(`Invalid database name: ${databaseName}`);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(readFileSync(ROLES_SQL, 'utf8'));

    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ]);
    if (!rowCount) {
      // CREATE DATABASE can't take parameters; the name was validated above.
      await admin.query(`create database ${databaseName} owner edu_owner`);
    }
    await admin.query(`revoke all on database ${databaseName} from public`);
    await admin.query(`grant connect on database ${databaseName} to ${RUNTIME_ROLES}`);
  } finally {
    await admin.end();
  }
}

/** Removes a database, disconnecting anyone still using it. Used to clean up after tests. */
export async function dropDatabase(adminUrl: string, databaseName: string): Promise<void> {
  if (!DATABASE_NAME.test(databaseName)) throw new Error(`Invalid database name: ${databaseName}`);
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${databaseName} with (force)`);
  } finally {
    await admin.end();
  }
}

/** Replaces user, password and database in a connection URL, keeping host and port. */
export function urlFor(baseUrl: string, role: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.username = role;
  url.password = role; // local roles use their name as password (infra/database/roles.sql)
  url.pathname = `/${databaseName}`;
  return url.toString();
}

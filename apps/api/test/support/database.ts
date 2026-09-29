/**
 * A fresh, throw-away database for integration tests, on your local PostgreSQL (ADR-0012).
 *
 * Each test file gets its own database named eduplatform_test_<random>, with the same roles
 * and migrations as development. It is dropped when the tests finish, so tests never touch
 * your development data and never depend on each other.
 *
 * Needs DATABASE_ADMIN_URL (a superuser connection) in the repository's .env file.
 */
import { join } from 'node:path';
import {
  createPool,
  loadLocalEnv,
  newId,
  runMigrations,
  type MigrationSource,
} from '@eduplatform/server-kit';
import { Client, type Pool } from 'pg';
import { dropDatabase, prepareDatabase, urlFor } from '../../src/db/local-database';
import { MIGRATION_SOURCES } from '../../src/db/migration-sources';

/** Test-only service used to prove the RLS and outbox patterns on a sample table. */
export const SAMPLE_SOURCE: MigrationSource = {
  module: 'sample',
  schema: 'sample',
  dir: join(__dirname, '..', 'fixtures', 'sample', 'migrations'),
};

export type Role = 'edu_owner' | 'edu_app' | 'edu_platform' | 'edu_relay' | 'edu_gateway';

export interface TestDatabase {
  /** Connection URL for one of the project's roles. */
  url(role: Role): string;
  /** A connection pool for one of the project's roles (created on first use). */
  pool(role: Role): Pool;
  /** Superuser connection, for reading the system catalog in tests. */
  admin: Client;
  stop(): Promise<void>;
}

export async function startDatabase(): Promise<TestDatabase> {
  loadLocalEnv();
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    throw new Error(
      'Integration tests need DATABASE_ADMIN_URL in the .env file at the repository root, e.g.\n' +
        '  DATABASE_ADMIN_URL=postgres://postgres:<password>@localhost:5432/postgres',
    );
  }

  const databaseName = `eduplatform_test_${newId().replace(/-/g, '').slice(-12)}`;
  await prepareDatabase(adminUrl, databaseName);

  const adminForTestDb = new URL(adminUrl);
  adminForTestDb.pathname = `/${databaseName}`;
  const admin = new Client({ connectionString: adminForTestDb.toString() });
  await admin.connect();

  const url = (role: Role) => urlFor(adminUrl, role, databaseName);
  const pools = new Map<Role, Pool>();
  const pool = (role: Role): Pool => {
    let p = pools.get(role);
    if (!p) {
      p = createPool(url(role), { max: 4 });
      pools.set(role, p);
    }
    return p;
  };

  await runMigrations(pool('edu_owner'), [...MIGRATION_SOURCES, SAMPLE_SOURCE]);

  return {
    url,
    pool,
    admin,
    async stop() {
      await Promise.all([...pools.values()].map((p) => p.end()));
      await admin.end();
      await dropDatabase(adminUrl, databaseName);
    },
  };
}

/**
 * `pnpm db:migrate`: creates or updates the tables of every service in services.ts.
 *
 * Runs as edu_owner, the only role allowed to change the schema (CLAUDE.md rule 6).
 * Already-applied migrations are skipped, so it is safe to run any time.
 */
import { createPool, loadLocalEnv, runMigrations } from '@eduplatform/server-kit';
import { MIGRATION_SOURCES } from './migration-sources';

async function main(): Promise<void> {
  loadLocalEnv();
  const url =
    process.env.DATABASE_OWNER_URL ??
    (process.env.NODE_ENV === 'production'
      ? undefined
      : 'postgres://edu_owner:edu_owner@localhost:5432/eduplatform');
  if (!url) throw new Error('DATABASE_OWNER_URL is required');

  const pool = createPool(url, { max: 2 });
  try {
    const applied = await runMigrations(pool, MIGRATION_SOURCES, (m) => console.log(m));
    console.log(
      applied.length ? `${applied.length} migration(s) applied` : 'Database is up to date',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

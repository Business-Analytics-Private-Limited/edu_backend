/**
 * `pnpm db:setup`: prepares your locally installed PostgreSQL for this project.
 *
 * Run it once after installing PostgreSQL (and again any time; it is safe to repeat).
 * It needs DATABASE_ADMIN_URL in the repository's .env file, for example:
 *
 *   DATABASE_ADMIN_URL=postgres://postgres:<your postgres password>@localhost:5432/postgres
 *
 * Then run `pnpm db:migrate` to create the tables.
 */
import { loadLocalEnv } from '@eduplatform/server-kit';
import { prepareDatabase } from './local-database';

async function main(): Promise<void> {
  loadLocalEnv();
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    throw new Error(
      'DATABASE_ADMIN_URL is not set. Add it to the .env file at the repository root, e.g.\n' +
        '  DATABASE_ADMIN_URL=postgres://postgres:<password>@localhost:5432/postgres',
    );
  }
  const databaseName = process.env.DATABASE_NAME ?? 'eduplatform';
  await prepareDatabase(adminUrl, databaseName);
  console.log(`Database "${databaseName}" and its roles are ready. Next: pnpm db:migrate`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

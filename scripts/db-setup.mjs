/**
 * Prepares your local PostgreSQL for this project.
 *
 *   pnpm db:setup     creates the roles and the databases (safe to repeat)
 *   pnpm db:reset     DELETES the development database and creates it again empty,
 *                     then migrates and seeds it (see package.json)
 *
 * Creates the development database "eduplatform". (Automated tests make their own temporary one.)
 * Needs DATABASE_ADMIN_URL (a PostgreSQL superuser) in the .env file.
 */
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  console.error('DATABASE_ADMIN_URL is missing in .env (see .env.example).');
  process.exit(1);
}

const reset = process.argv.includes('--reset');
const databases = ['eduplatform'];

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  // 1. Roles
  await client.query(readFileSync('infra/database/roles.sql', 'utf8'));

  // 2. Databases, owned by edu_owner
  for (const name of databases) {
    if (reset && name === 'eduplatform') {
      await client.query(`drop database if exists ${name} with (force)`);
      console.log(`Deleted database "${name}"`);
    }
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (!rowCount) {
      await client.query(`create database ${name} owner edu_owner`);
      console.log(`Created database "${name}"`);
    }
    await client.query(`grant connect on database ${name} to edu_app`);
  }
  console.log('Roles and databases are ready. Next: pnpm db:migrate && pnpm db:seed');
} finally {
  await client.end();
}

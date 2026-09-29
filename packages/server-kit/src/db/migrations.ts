import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { ident, withTransaction } from './transaction';

/** One module's migrations. Each module owns one schema (CLAUDE.md rule 2). */
export interface MigrationSource {
  module: string;
  schema: string;
  dir: string;
}

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  schema: string;
  version: string;
}

const FILE_NAME = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function listMigrationFiles(dir: string): MigrationFile[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const invalid = files.filter((f) => !FILE_NAME.test(f));
  if (invalid.length > 0) {
    throw new Error(`Migration file names must look like 0001_name.sql: ${invalid.join(', ')}`);
  }
  return files.sort().map((file) => {
    const sql = readFileSync(join(dir, file), 'utf8');
    return {
      version: file.slice(0, 4),
      name: file,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });
}

/**
 * Applies pending migrations, module by module in the given order. Runs as the migration
 * owner role (`edu_owner`), never as a runtime role.
 *
 * - Each module's schema gets its own `schema_migrations` table, so a module's history can
 *   move with it if the module is extracted (docs/07-database-design.md §7.5).
 * - Each file runs in its own transaction.
 * - A file that was changed after being applied stops the run (checksum mismatch).
 */
export async function runMigrations(
  pool: Pool,
  sources: MigrationSource[],
  log: (message: string) => void = () => undefined,
): Promise<AppliedMigration[]> {
  const applied: AppliedMigration[] = [];
  const lock = await pool.connect();
  try {
    // One runner at a time, even when several deploys start together.
    await lock.query(`select pg_advisory_lock(hashtext('eduplatform.migrations'))`);

    for (const source of sources) {
      const schema = ident(source.schema);
      await pool.query(`create schema if not exists ${schema}`);
      await pool.query(
        `create table if not exists ${schema}.schema_migrations (
           version    text primary key,
           name       text not null,
           checksum   text not null,
           applied_at timestamptz not null default now()
         )`,
      );
      const { rows } = await pool.query<{ version: string; checksum: string }>(
        `select version, checksum from ${schema}.schema_migrations`,
      );
      const done = new Map(rows.map((r) => [r.version, r.checksum]));

      for (const file of listMigrationFiles(source.dir)) {
        const previous = done.get(file.version);
        if (previous) {
          if (previous !== file.checksum) {
            throw new Error(
              `${source.module}/${file.name} changed after it was applied. ` +
                'Write a new migration instead of editing an applied one.',
            );
          }
          continue;
        }
        await withTransaction(pool, async ({ client }) => {
          await client.query(file.sql);
          await client.query(
            `insert into ${schema}.schema_migrations (version, name, checksum) values ($1, $2, $3)`,
            [file.version, file.name, file.checksum],
          );
        });
        log(`applied ${source.module}/${file.name}`);
        applied.push({ schema: source.schema, version: file.version });
      }
    }
  } finally {
    await lock
      .query(`select pg_advisory_unlock(hashtext('eduplatform.migrations'))`)
      .catch(() => undefined);
    lock.release();
  }
  return applied;
}

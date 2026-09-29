/**
 * Where the migrations of this host come from, in the order they must run:
 *   1. the foundation (schema "app": the tenant-check function used by every RLS policy),
 *   2. each service in services.ts, in the listed order.
 *
 * Always ALL services, even when ENABLED_SERVICES runs only some: they share one database,
 * so its schema must be complete whichever services a process happens to run.
 *
 * Each service keeps its own migrations in its package's migrations/ folder and its own
 * tables in its own schema (CLAUDE.md rule 2).
 */
import { FOUNDATION_MIGRATIONS_DIR, type MigrationSource } from '@eduplatform/server-kit';
import { ALL_SERVICES } from '../services';

export const MIGRATION_SOURCES: MigrationSource[] = [
  { module: 'foundation', schema: 'app', dir: FOUNDATION_MIGRATIONS_DIR },
  ...ALL_SERVICES.map((service) => ({
    module: service.manifest.key,
    schema: service.manifest.key,
    dir: service.migrationsDir,
  })),
];

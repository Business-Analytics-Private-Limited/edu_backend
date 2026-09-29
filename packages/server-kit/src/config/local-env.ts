/**
 * Loads the repository's `.env` file for local development.
 *
 * Every backend app, script and test calls this first, so a developer keeps their local
 * settings (for example DATABASE_ADMIN_URL with their own Postgres password) in ONE file at
 * the repository root. Variables already set in the environment always win.
 *
 * In production nothing is loaded: settings come from the deployment environment only.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function loadLocalEnv(startDir: string = process.cwd()): void {
  if (process.env.NODE_ENV === 'production') return;

  // Walk up until we find the repository root (it holds pnpm-workspace.yaml).
  let dir = startDir;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) return; // reached the drive root: not inside the repository
    dir = parent;
  }

  const envFile = join(dir, '.env');
  if (existsSync(envFile)) {
    // Built into Node.js 20.12+. Does not overwrite variables that are already set.
    process.loadEnvFile(envFile);
  }
}

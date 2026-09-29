/**
 * Database transactions.
 *
 * Every query on tenant data goes through withTenantTransaction():
 *
 *   await withTenantTransaction(pool, async (tx) => {
 *     const { rows } = await tx.client.query('select * from students.students where id = $1', [id]);
 *   });
 *
 * It tells PostgreSQL which tenant the transaction belongs to, and Row-Level Security then
 * hides every other tenant's rows. Forgetting it is safe: queries fail with
 * "app.tenant_id is not set" instead of returning other tenants' data.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { requireTenantId } from '../context/request-context';
import { isUuid } from '../ids';

/** A running transaction: the raw client for SQL, and a Drizzle instance bound to it. */
export interface Tx {
  client: PoolClient;
  db: NodePgDatabase;
}

export function createPool(connectionString: string, options: Partial<PoolConfig> = {}): Pool {
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, ...options });
}

/**
 * Runs `fn` in one transaction. `settings` are applied with `set_config(name, value, true)`,
 * so they last only until the transaction ends and never leak to the next user of the
 * pooled connection (compatible with PgBouncer transaction mode, ADR-0002).
 */
export async function withTransaction<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
  settings: Record<string, string> = {},
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('begin');
    for (const [name, value] of Object.entries(settings)) {
      await client.query('select set_config($1, $2, true)', [name, value]);
    }
    const result = await fn({ client, db: drizzle({ client }) });
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    // A connection whose rollback failed is in an unknown state: destroy it instead of reusing it.
    client.release(broken);
  }
}

/**
 * Runs `fn` in a transaction scoped to one tenant. Row-Level Security reads `app.tenant_id`;
 * every tenant-owned query must go through this function (docs/07-database-design.md §7.4).
 */
export function withTenantTransaction<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
  tenantId: string = requireTenantId(),
): Promise<T> {
  if (!isUuid(tenantId)) throw new Error('Tenant id must be a UUID');
  return withTransaction(pool, fn, { 'app.tenant_id': tenantId });
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Quotes a trusted schema or table name. Rejects anything that isn't a plain identifier. */
export function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`);
  return `"${name}"`;
}

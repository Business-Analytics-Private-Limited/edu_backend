import {
  newId,
  OutboxRelay,
  publishEvent,
  recordAudit,
  runMigrations,
  runWithContext,
  withTenantTransaction,
  withTransaction,
  type RequestContext,
} from '@eduplatform/server-kit';
import type { CloudEvent } from '@eduplatform/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATION_SOURCES } from '../../src/db/migration-sources';
import { SAMPLE_SOURCE, startDatabase, type TestDatabase } from '../support/database';

// The database rules of docs/07-database-design.md §7.8, checked against real Postgres.

const RUNTIME_ROLES = ['edu_app', 'edu_platform', 'edu_relay', 'edu_gateway'];
const tenantA = newId();
const tenantB = newId();
const contextFor = (tenantId: string): RequestContext => ({
  requestId: newId(),
  actorType: 'user',
  tenantId,
  userId: newId(),
});

let db: TestDatabase;

beforeAll(async () => {
  db = await startDatabase();
});

afterAll(async () => {
  await db?.stop();
});

describe('catalog rules', () => {
  it('every table with tenant_id has RLS enabled and forced, and a tenant_isolation policy', async () => {
    const { rows } = await db.admin.query<{
      name: string;
      schema: string;
      table: string;
      enabled: boolean;
      forced: boolean;
      is_partition: boolean;
      has_policy: boolean;
    }>(`
      select c.oid::regclass::text as name, n.nspname as schema, c.relname as table,
             c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             c.relispartition as is_partition,
             exists (select 1 from pg_policies p
                      where p.schemaname = n.nspname and p.tablename = c.relname
                        and p.policyname = 'tenant_isolation') as has_policy
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
       where c.relkind in ('r', 'p')
         and n.nspname not in ('pg_catalog', 'information_schema')`);

    expect(rows.length).toBeGreaterThan(0);
    const problems = rows.flatMap((r) => [
      ...(r.enabled ? [] : [`${r.name}: RLS not enabled`]),
      ...(r.forced ? [] : [`${r.name}: RLS not forced`]),
      // Partitions are reached only through their parent, whose policy applies.
      ...(r.is_partition || r.has_policy ? [] : [`${r.name}: no tenant_isolation policy`]),
    ]);
    expect(problems).toEqual([]);
  });

  it('no foreign key crosses schemas', async () => {
    const { rows } = await db.admin.query(`
      select con.conname, c.oid::regclass::text as from_table, f.oid::regclass::text as to_table
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_class f on f.oid = con.confrelid
       where con.contype = 'f' and c.relnamespace <> f.relnamespace`);
    expect(rows).toEqual([]);
  });

  it('every tenant table has an index that starts with tenant_id', async () => {
    const { rows } = await db.admin.query<{ name: string }>(`
      select c.oid::regclass::text as name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
       where c.relkind in ('r', 'p') and not c.relispartition
         and n.nspname not in ('pg_catalog', 'information_schema')
         and not exists (
           select 1 from pg_index i
             join pg_attribute k on k.attrelid = i.indrelid and k.attnum = i.indkey[0]
            where i.indrelid = c.oid and k.attname = 'tenant_id')`);
    expect(rows.map((r) => r.name)).toEqual([]);
  });

  it('runtime roles cannot bypass RLS and own no tables', async () => {
    const { rows: bypass } = await db.admin.query(
      `select rolname from pg_roles where rolname = any($1) and (rolbypassrls or rolsuper)`,
      [RUNTIME_ROLES],
    );
    expect(bypass).toEqual([]);
    const { rows: owned } = await db.admin.query(
      `select c.oid::regclass::text from pg_class c join pg_roles r on r.oid = c.relowner
        where r.rolname = any($1)`,
      [RUNTIME_ROLES],
    );
    expect(owned).toEqual([]);
  });

  it('the audit log is append-only for the application role', async () => {
    const { rows } = await db.admin.query(`
      select has_table_privilege('edu_app', 'audit.entries', 'INSERT') as can_insert,
             has_table_privilege('edu_app', 'audit.entries', 'UPDATE') as can_update,
             has_table_privilege('edu_app', 'audit.entries', 'DELETE') as can_delete`);
    expect(rows[0]).toEqual({ can_insert: true, can_update: false, can_delete: false });
  });

  it('migrations are idempotent', async () => {
    const applied = await runMigrations(db.pool('edu_owner'), [
      ...MIGRATION_SOURCES,
      SAMPLE_SOURCE,
    ]);
    expect(applied).toEqual([]);
  });
});

describe('tenant isolation on a sample table', () => {
  it('fails instead of returning rows when the tenant is not set', async () => {
    await expect(db.pool('edu_app').query('select * from sample.notes')).rejects.toThrow(
      /app.tenant_id is not set/,
    );
    await expect(
      withTransaction(
        db.pool('edu_app'),
        ({ client }) => client.query('select * from sample.notes'),
        {
          'app.tenant_id': '',
        },
      ),
    ).rejects.toThrow(/app.tenant_id is not set/);
  });

  it("hides, protects and refuses tenant A's rows from tenant B", async () => {
    const pool = db.pool('edu_app');
    const noteId = newId();
    await withTenantTransaction(
      pool,
      ({ client }) =>
        client.query('insert into sample.notes (id, tenant_id, body) values ($1, $2, $3)', [
          noteId,
          tenantA,
          'visible to A only',
        ]),
      tenantA,
    );

    const seenByA = await withTenantTransaction(
      pool,
      ({ client }) => client.query('select id from sample.notes where id = $1', [noteId]),
      tenantA,
    );
    expect(seenByA.rowCount).toBe(1);

    await withTenantTransaction(
      pool,
      async ({ client }) => {
        expect((await client.query('select id from sample.notes')).rowCount).toBe(0);
        expect(
          (await client.query(`update sample.notes set body = 'x' where id = $1`, [noteId]))
            .rowCount,
        ).toBe(0);
        expect(
          (await client.query('delete from sample.notes where id = $1', [noteId])).rowCount,
        ).toBe(0);
      },
      tenantB,
    );

    await expect(
      withTenantTransaction(
        pool,
        ({ client }) =>
          client.query('insert into sample.notes (id, tenant_id, body) values ($1, $2, $3)', [
            newId(),
            tenantA,
            'written from B',
          ]),
        tenantB,
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('audit writer', () => {
  it('records entries visible only to their tenant, and they cannot be changed', async () => {
    const pool = db.pool('edu_app');
    const entityId = newId();
    await runWithContext(contextFor(tenantA), () =>
      withTenantTransaction(pool, (tx) =>
        recordAudit(tx, {
          moduleKey: 'sample',
          entityType: 'sample.note',
          entityId,
          action: 'update',
          before: { body: 'old', token: 'a' },
          after: { body: 'new', token: 'b' },
        }),
      ),
    );

    const fromA = await withTenantTransaction(
      pool,
      ({ client }) =>
        client.query('select changes from audit.entries where entity_id = $1', [entityId]),
      tenantA,
    );
    expect(fromA.rows[0]?.changes).toEqual({
      body: ['old', 'new'],
      token: ['[redacted]', '[redacted]'],
    });

    const fromB = await withTenantTransaction(
      pool,
      ({ client }) => client.query('select 1 from audit.entries where entity_id = $1', [entityId]),
      tenantB,
    );
    expect(fromB.rowCount).toBe(0);

    await expect(
      withTenantTransaction(
        pool,
        ({ client }) =>
          client.query(`update audit.entries set action = 'x' where entity_id = $1`, [entityId]),
        tenantA,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('outbox', () => {
  it('writes events only when the transaction commits, and the relay delivers them in order', async () => {
    const pool = db.pool('edu_app');
    const subject = newId();
    const event = (n: number) => ({
      type: 'sample.note.created',
      subject,
      dataSchema: 'sample.note.created/1',
      data: { n },
    });

    await runWithContext(contextFor(tenantA), async () => {
      await expect(
        withTenantTransaction(pool, async (tx) => {
          await publishEvent(tx, 'sample', event(0));
          throw new Error('business write failed');
        }),
      ).rejects.toThrow('business write failed');

      await withTenantTransaction(pool, async (tx) => {
        await publishEvent(tx, 'sample', event(1));
        await publishEvent(tx, 'sample', event(2));
      });
    });

    const delivered: CloudEvent[] = [];
    const relay = new OutboxRelay(db.pool('edu_relay'), ['sample'], async (e) => {
      delivered.push(e);
    });
    expect(await relay.relayOnce()).toBe(2);
    expect(delivered.map((e) => (e.data as { n: number }).n)).toEqual([1, 2]);
    expect(delivered[0]).toMatchObject({
      specversion: '1.0',
      type: 'sample.note.created',
      source: '/modules/sample',
      tenantid: tenantA,
      subject,
    });
    expect(await relay.relayOnce()).toBe(0);
  });

  it('refuses events of another module', async () => {
    await runWithContext(contextFor(tenantA), async () => {
      await expect(
        withTenantTransaction(db.pool('edu_app'), (tx) =>
          publishEvent(tx, 'sample', {
            type: 'students.student.admitted',
            subject: newId(),
            dataSchema: 'students.student.admitted/1',
            data: {},
          }),
        ),
      ).rejects.toThrow(/only publish its own events/);
    });
  });

  it('gives the relay role no access to business tables', async () => {
    await expect(db.pool('edu_relay').query('select * from sample.notes')).rejects.toThrow(
      /permission denied/,
    );
  });
});

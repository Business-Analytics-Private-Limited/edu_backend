/**
 * The super admin journey through the real API and a real database (Phase 2 step 2a):
 * catalog → create organization → institution → activate → grant modules with the
 * dependency rules → take a module away → edits with optimistic locking → search.
 *
 * Also checks who may do it (owner vs support vs tenant users vs strangers), that every
 * action is audited and emits an event, and that tenants stay isolated in the database.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PLATFORM_FACADE, type PlatformFacade } from '@eduplatform/platform-service/public';
import { newId, withTenantTransaction } from '@eduplatform/server-kit';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from '../support/app';
import { startDatabase, type TestDatabase } from '../support/database';
import { createTestTokens, type TestTokens } from '../support/tokens';

let db: TestDatabase;
let app: NestExpressApplication;
let tokens: TestTokens;
let owner: string; // token of a platform_owner
let support: string; // token of a platform_support

const server = () => app.getHttpServer();
const asOwner = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
  request(server())[method](`/api/v1${path}`).set('Authorization', `Bearer ${owner}`);

beforeAll(async () => {
  db = await startDatabase();
  tokens = await createTestTokens();

  // Two platform staff members, linked to Keycloak accounts "kc-owner" and "kc-support".
  await db.admin.query(
    `insert into platform.platform_users (id, keycloak_sub, email, display_name, role)
     values ($1, 'kc-owner', 'owner@eduplatform.test', 'Owner', 'platform_owner'),
            ($2, 'kc-support', 'support@eduplatform.test', 'Support', 'platform_support')`,
    [newId(), newId()],
  );
  owner = await tokens.sign('platform', 'kc-owner');
  support = await tokens.sign('platform', 'kc-support');

  app = await startTestApp(db, tokens); // also syncs the module catalog
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

describe('module catalog', () => {
  it('lists every v1 module with dependencies and variants', async () => {
    const res = await asOwner('get', '/admin/modules').expect(200);
    const byKey = Object.fromEntries(res.body.data.map((m: { key: string }) => [m.key, m]));
    expect(Object.keys(byKey)).toEqual(
      expect.arrayContaining([
        'platform',
        'audit',
        'identity',
        'access',
        'files',
        'academic',
        'students',
        'attendance',
      ]),
    );
    expect(byKey.attendance.dependsOn).toEqual(['academic', 'students']);
    expect(byKey.attendance.variants.map((v: { key: string }) => v.key)).toContain('biometric');
    expect(byKey.platform.isCore).toBe(true);
  });
});

describe('onboarding an organization', () => {
  let tenantId: string;

  it('creates it in onboarding with the core modules enabled', async () => {
    const res = await asOwner('post', '/admin/tenants')
      .send({
        slug: 'demo-society',
        legalName: 'Demo Educational Society',
        displayName: 'Demo Society',
      })
      .expect(201);
    tenantId = res.body.data.id;
    expect(res.body.data).toMatchObject({ slug: 'demo-society', status: 'onboarding', version: 1 });

    const detail = await asOwner('get', `/admin/tenants/${tenantId}`).expect(200);
    const enabled = detail.body.data.entitlements.filter((e: { enabled: boolean }) => e.enabled);
    expect(enabled.map((e: { moduleKey: string }) => e.moduleKey).sort()).toEqual([
      'access',
      'audit',
      'files',
      'identity',
      'platform',
    ]);
  });

  it('refuses a duplicate slug and bad input', async () => {
    await asOwner('post', '/admin/tenants')
      .send({ slug: 'demo-society', legalName: 'Other', displayName: 'Other' })
      .expect(409);
    const bad = await asOwner('post', '/admin/tenants')
      .send({ slug: 'Bad Slug', legalName: 'X', displayName: 'Y', tenantId: 'sneaky' })
      .expect(422);
    const paths = bad.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['slug', 'legalName']));
    expect(bad.body.errors.some((e: { code: string }) => e.code === 'unrecognized_keys')).toBe(
      true,
    );
  });

  it('needs an institution before activation', async () => {
    const res = await asOwner('post', `/admin/tenants/${tenantId}/activate`).expect(422);
    expect(res.body.errors[0].code).toBe('required');
  });

  it('adds an institution with its first campus, and refuses a duplicate code', async () => {
    const body = {
      code: 'DJC',
      name: 'Demo Junior College',
      type: 'junior_college',
      campus: { code: 'KKP', name: 'Kukatpally' },
    };
    const res = await asOwner('post', `/admin/tenants/${tenantId}/institutions`)
      .send(body)
      .expect(201);
    expect(res.body.data).toMatchObject({
      code: 'DJC',
      structureTemplateKey: 'junior_college_v1',
      timezone: 'Asia/Kolkata',
      campuses: [{ code: 'KKP', name: 'Kukatpally', status: 'active' }],
    });
    await asOwner('post', `/admin/tenants/${tenantId}/institutions`).send(body).expect(409);
  });

  it('activates, suspends with a reason, and reactivates', async () => {
    await asOwner('post', `/admin/tenants/${tenantId}/activate`).expect(200);
    await asOwner('post', `/admin/tenants/${tenantId}/suspend`).send({}).expect(422);
    const suspended = await asOwner('post', `/admin/tenants/${tenantId}/suspend`)
      .send({ reason: 'Testing suspension' })
      .expect(200);
    expect(suspended.body.data).toMatchObject({
      status: 'suspended',
      statusReason: 'Testing suspension',
    });
    const active = await asOwner('post', `/admin/tenants/${tenantId}/reactivate`)
      .send({ reason: 'Paid' })
      .expect(200);
    expect(active.body.data.status).toBe('active');
  });

  it('grants modules only in dependency order', async () => {
    const put = (key: string, body: object = {}) =>
      asOwner('put', `/admin/tenants/${tenantId}/entitlements/${key}`).send(body);

    const early = await put('students').expect(422);
    expect(early.body.errors[0].code).toBe('missing_dependency');

    await put('academic').expect(200);
    const students = await put('students').expect(200);
    expect(students.body.data).toMatchObject({
      enabled: true,
      allowedVariants: ['manual'],
      source: 'override',
    });

    const attendance = await put('attendance', {
      allowedVariants: ['manual', 'biometric'],
      limits: { 'devices.max': 3 },
    }).expect(200);
    expect(attendance.body.data).toMatchObject({
      allowedVariants: ['manual', 'biometric'],
      limits: { 'devices.max': 3 },
    });

    await put('attendance', { allowedVariants: ['rfid'] }).expect(422); // planned variant
    await put('attendance', { limits: { 'students.max': 1 } }).expect(422); // not its limit
    await put('no_such_module').expect(422);
  });

  it('answers the module check used on every request', async () => {
    const platform = app.get<PlatformFacade>(PLATFORM_FACADE, { strict: false });
    expect(await platform.isModuleEnabled(tenantId, 'attendance')).toBe(true);
    expect(await platform.isModuleEnabled(tenantId, 'imports')).toBe(false);
  });

  it('takes modules away only when nothing depends on them, never core ones', async () => {
    const del = (key: string) =>
      asOwner('delete', `/admin/tenants/${tenantId}/entitlements/${key}`);

    const blocked = await del('students').expect(422);
    expect(blocked.body.errors[0].code).toBe('has_dependents');
    await del('audit').expect(422);

    const removed = await del('attendance').expect(200);
    expect(removed.body.data.enabled).toBe(false);
    expect(new Date(removed.body.data.readOnlyUntil).getTime()).toBeGreaterThan(
      Date.now() + 80 * 86_400_000,
    );
    await del('attendance').expect(404); // already taken away

    // The cache was refreshed by the change, so the next check is already false.
    const platform = app.get<PlatformFacade>(PLATFORM_FACADE, { strict: false });
    expect(await platform.isModuleEnabled(tenantId, 'attendance')).toBe(false);
  });

  it('edits details with optimistic locking', async () => {
    const current = await asOwner('get', `/admin/tenants/${tenantId}`).expect(200);
    const etag = String(current.headers.etag);
    expect(etag).toMatch(/^"\d+"$/);

    await asOwner('patch', `/admin/tenants/${tenantId}`).send({ displayName: 'Demo' }).expect(400);
    const updated = await asOwner('patch', `/admin/tenants/${tenantId}`)
      .set('If-Match', etag)
      .send({ displayName: 'Demo Society (renamed)' })
      .expect(200);
    expect(updated.body.data.displayName).toBe('Demo Society (renamed)');

    const stale = await asOwner('patch', `/admin/tenants/${tenantId}`)
      .set('If-Match', etag)
      .send({ displayName: 'Lost update' })
      .expect(409);
    expect(stale.body.code).toBe('version_conflict');
  });

  it('audits every action and emits events in the same transaction', async () => {
    const audit = await db.admin.query(
      `select action from audit.platform_entries where target_tenant_id = $1 order by occurred_at`,
      [tenantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'create',
        'activate',
        'suspend',
        'reactivate',
        'enable',
        'disable',
        'update',
      ]),
    );
    const events = await db.admin.query(`select type from platform.outbox where tenant_id = $1`, [
      tenantId,
    ]);
    expect(events.rows.map((r) => r.type)).toEqual(
      expect.arrayContaining([
        'platform.tenant.created',
        'platform.institution.changed',
        'platform.tenant.status_changed',
        'platform.module.enabled',
        'platform.module.disabled',
      ]),
    );
  });
});

describe('searching organizations', () => {
  it('pages through results, newest first', async () => {
    await asOwner('post', '/admin/tenants')
      .send({ slug: 'second-society', legalName: 'Second Society', displayName: 'Second Society' })
      .expect(201);

    const first = await asOwner('get', '/admin/tenants?limit=1').expect(200);
    expect(first.body.data[0].slug).toBe('second-society');
    expect(first.body.page.hasMore).toBe(true);

    const second = await asOwner(
      'get',
      `/admin/tenants?limit=1&cursor=${first.body.page.nextCursor}`,
    ).expect(200);
    expect(second.body.data[0].slug).toBe('demo-society');

    const filtered = await asOwner('get', '/admin/tenants?q=second').expect(200);
    expect(filtered.body.data.map((t: { slug: string }) => t.slug)).toEqual(['second-society']);
  });
});

describe('who may use the super admin endpoints', () => {
  it('lets support staff look but not change', async () => {
    await request(server())
      .get('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${support}`)
      .expect(200);
    const res = await request(server())
      .post('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${support}`)
      .send({ slug: 'nope', legalName: 'Nope', displayName: 'Nope' })
      .expect(403);
    expect(res.body.code).toBe('permission_denied');
  });

  it('refuses people who are not active platform staff', async () => {
    const stranger = await tokens.sign('platform', 'kc-unknown');
    await request(server())
      .get('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${stranger}`)
      .expect(401);
    const tenantUser = await tokens.sign('tenants', 'kc-teacher', {
      organization: ['demo-society'],
    });
    await request(server())
      .get('/api/v1/admin/tenants')
      .set('Authorization', `Bearer ${tenantUser}`)
      .expect(401);
    await request(server()).get('/api/v1/admin/tenants').expect(401);
  });
});

describe('tenant isolation in the platform schema', () => {
  it('shows a tenant user only their own organization and institutions', async () => {
    const pool = db.pool('edu_app');
    const { rows } = await db.admin.query<{ id: string; slug: string }>(
      `select id, slug from platform.tenants`,
    );
    const demo = rows.find((r) => r.slug === 'demo-society')!;
    const second = rows.find((r) => r.slug === 'second-society')!;

    const seenByDemo = await withTenantTransaction(
      pool,
      async ({ client }) => ({
        tenants: (await client.query('select slug from platform.tenants')).rows.map((r) => r.slug),
        institutions: (await client.query('select code from platform.institutions')).rows.map(
          (r) => r.code,
        ),
      }),
      demo.id,
    );
    expect(seenByDemo).toEqual({ tenants: ['demo-society'], institutions: ['DJC'] });

    const seenBySecond = await withTenantTransaction(
      pool,
      async ({ client }) => ({
        tenants: (await client.query('select slug from platform.tenants')).rows.map((r) => r.slug),
        institutions: (await client.query('select code from platform.institutions')).rows.length,
      }),
      second.id,
    );
    expect(seenBySecond).toEqual({ tenants: ['second-society'], institutions: 0 });
  });
});

/**
 * Small helpers for the end-to-end tests.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

/** Starts the real app, with the same settings as in production (setupApp). */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app);
  await app.init();
  return app;
}

/**
 * Logs in the test super admin (created by the seed) and returns the token. (global-setup.ts
 * marks its password as already changed, so every test file can use it.)
 */
export async function loginSuperAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/super-admin/login')
    .send({ email: 'superadmin@test.local', password: 'SuperAdmin@123' })
    .expect(200);
  return res.body.accessToken;
}

/**
 * Temporary passwords changed at the first login: "email" -> { from, to }. Tests keep using the
 * password they gave the account; the helpers use the new one.
 */
const changedPasswords = new Map<string, { from: string; to: string }>();

/** The password an account has now, for the password a test gave it. */
export function currentPassword(email: string, password: string): string {
  const changed = changedPasswords.get(email.toLowerCase());
  return changed && changed.from === password ? changed.to : password;
}

/**
 * Logs in an organization user and returns the token. Accounts start with a temporary password
 * that must be changed first (ADR-0028): on the first login the helper changes it, like a real
 * user would, and remembers the new one.
 */
export async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const now = currentPassword(email, password);
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: now })
    .expect(200);
  const token: string = res.body.accessToken;
  if (res.body.user.mustChangePassword) {
    const next = `${now}-new1`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: now, newPassword: next })
      .expect(200);
    changedPasswords.set(email.toLowerCase(), { from: password, to: next });
  }
  return token;
}

type OrganizationType = 'SCHOOL' | 'INTERMEDIATE' | 'DEGREE' | 'ENGINEERING';

/**
 * Creates an organization with its first admin and its branches, as the super admin (ADR-0030).
 * Returns its id. Defaults: an Intermediate college with one branch, code MAIN.
 */
export async function createOrganization(
  app: INestApplication,
  superAdminToken: string,
  slug: string,
  adminEmail: string,
  options: {
    type?: OrganizationType;
    branches?: { name: string; code: string }[];
    modules?: string[];
  } = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/super-admin/organizations')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({
      name: `${slug} society`,
      slug,
      code: slug
        .replace(/[^a-z0-9]/g, '')
        .toUpperCase()
        .slice(0, 10),
      type: options.type ?? 'INTERMEDIATE',
      admin: { name: `${slug} admin`, email: adminEmail, password: 'Admin@12345' },
      branches: options.branches ?? [{ name: `${slug} main branch`, code: 'MAIN' }],
    })
    .expect(201);
  for (const key of options.modules ?? []) {
    await request(app.getHttpServer())
      .put(`/api/v1/super-admin/organizations/${res.body.id}/modules/${key}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ enabled: true })
      .expect(200);
  }
  return res.body.id;
}

/** The id of an organization's branch, by its code (asked as the super admin). */
export async function branchId(
  app: INestApplication,
  superAdminToken: string,
  organizationId: string,
  code: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/super-admin/organizations/${organizationId}`)
    .set('Authorization', `Bearer ${superAdminToken}`)
    .expect(200);
  return res.body.branches.find((b: { code: string }) => b.code === code).id;
}

/**
 * The id of a class of the structure, by its codes from the top, e.g. ["JR", "MPC", "REG"]
 * (Junior > MPC > Regular). Sections need the branch too.
 */
export async function classId(
  app: INestApplication,
  token: string,
  codes: string[],
  branch?: string,
): Promise<string> {
  const structure = await request(app.getHttpServer())
    .get('/api/v1/academic-structure')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  let parentId: string | null = null;
  const nodes = structure.body.classes as { id: string; parentId: string | null; code: string }[];
  const above = branch ? codes.slice(0, -1) : codes;
  for (const code of above) {
    const node = nodes.find((c) => c.parentId === parentId && c.code === code);
    if (!node) throw new Error(`No class ${codes.join(' > ')} (stuck at ${code})`);
    parentId = node.id;
  }
  if (!branch) return parentId!;
  const sections = await request(app.getHttpServer())
    .get(`/api/v1/branches/${branch}/sections`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  const section = sections.body.sections.find(
    (c: { parentId: string; code: string }) => c.parentId === parentId && c.code === codes.at(-1),
  );
  if (!section) throw new Error(`No section ${codes.join(' > ')}`);
  return section.id;
}

/**
 * An Intermediate college's structure for the tests: the groups switched on, extra streams, and
 * sections (at a branch) under "year > group > stream". Returns the sections' ids by key / code.
 */
export async function setUpIntermediate(
  app: INestApplication,
  adminToken: string,
  branch: string,
  setup: {
    groups: string[];
    streams?: { groupCode: string; name: string; code: string; longTerm?: boolean }[];
    /** `key` names the section in the returned ids (default: its code). */
    sections: { under: string[]; name: string; code: string; key?: string }[];
  },
): Promise<Record<string, string>> {
  const api = () => request(app.getHttpServer());
  const auth = { Authorization: `Bearer ${adminToken}` };
  await api()
    .put('/api/v1/academic-structure/groups')
    .set(auth)
    .send({ codes: setup.groups })
    .expect(200);
  for (const stream of setup.streams ?? []) {
    await api().post('/api/v1/academic-structure/streams').set(auth).send(stream).expect(201);
  }
  const ids: Record<string, string> = {};
  for (const section of setup.sections) {
    // Looked up first: a request must not be built while another one runs (shared test server).
    const parentId = await classId(app, adminToken, section.under);
    const res = await api()
      .post(`/api/v1/branches/${branch}/sections`)
      .set(auth)
      .send({ parentId, name: section.name, code: section.code })
      .expect(201);
    ids[section.key ?? section.code] = res.body.id;
  }
  return ids;
}

/** Creates an academic year (as an admin) and returns its id. */
export async function createYear(
  app: INestApplication,
  adminToken: string,
  name: string,
  startsOn: string,
  endsOn: string,
  activate = false,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/academic-years')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, startsOn, endsOn })
    .expect(201);
  if (activate) {
    await request(app.getHttpServer())
      .post(`/api/v1/academic-years/${res.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  }
  return res.body.id;
}

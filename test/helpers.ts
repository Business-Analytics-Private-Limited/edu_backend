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

/** The institution most tests use (only the super admin adds institutions, ADR-0025). */
export const SVJC = { name: 'Sri Vidya Junior College', code: 'SVJC' };

/** The class levels a junior college works with in the tests. */
export const JUNIOR_COLLEGE_LEVELS = ['Year', 'Group', 'Section'];

/**
 * Creates an organization with its first admin and its institutions, as the super admin.
 * Returns its id. Without `institutions` it gets one, code MAIN.
 */
export async function createOrganization(
  app: INestApplication,
  superAdminToken: string,
  slug: string,
  adminEmail: string,
  institutions: { name: string; code: string }[] = [{ name: `${slug} college`, code: 'MAIN' }],
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/super-admin/organizations')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({
      name: `${slug} society`,
      slug,
      admin: { name: `${slug} admin`, email: adminEmail, password: 'Admin@12345' },
      institutions,
    })
    .expect(201);
  return res.body.id;
}

/** The id of an organization's institution, by its code (asked as the super admin). */
export async function institutionId(
  app: INestApplication,
  superAdminToken: string,
  organizationId: string,
  code: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/super-admin/organizations/${organizationId}`)
    .set('Authorization', `Bearer ${superAdminToken}`)
    .expect(200);
  return res.body.institutions.find((i: { code: string }) => i.code === code).id;
}

/** Sets an institution's class levels (before it has classes), as an organization admin. */
export async function setClassLevels(
  app: INestApplication,
  adminToken: string,
  institutionId: string,
  names: string[],
): Promise<void> {
  await request(app.getHttpServer())
    .put(`/api/v1/institutions/${institutionId}/class-levels`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ names })
    .expect(200);
}

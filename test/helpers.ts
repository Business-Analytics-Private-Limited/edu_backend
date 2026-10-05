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

/** Logs in the test super admin (created by the seed) and returns the token. */
export async function loginSuperAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/super-admin/login')
    .send({ email: 'superadmin@test.local', password: 'SuperAdmin@123' })
    .expect(200);
  return res.body.accessToken;
}

/** Logs in an organization user and returns the token. */
export async function loginUser(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return res.body.accessToken;
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

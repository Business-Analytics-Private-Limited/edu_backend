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

/** Creates an organization with its first admin, as the super admin. Returns its id. */
export async function createOrganization(
  app: INestApplication,
  superAdminToken: string,
  slug: string,
  adminEmail: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/super-admin/organizations')
    .set('Authorization', `Bearer ${superAdminToken}`)
    .send({
      name: `${slug} society`,
      slug,
      admin: { name: `${slug} admin`, email: adminEmail, password: 'Admin@12345' },
    })
    .expect(201);
  return res.body.id;
}

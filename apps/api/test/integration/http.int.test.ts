/**
 * The HTTP pipeline end to end: health, errors, security headers, Swagger, and login checks.
 *
 * Login is tested with tokens signed by keys generated here (no running Keycloak needed),
 * against two test-only endpoints: one for any logged-in user, one needing a permission.
 */
import { Controller, Get, Module } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  AUTHENTICATOR,
  AuthenticatedOnly,
  createLogger,
  createPool,
  currentContext,
  KeycloakAuthenticator,
  KeycloakTokenVerifier,
  RequireModule,
  RequirePermission,
  type AuthenticatedIdentity,
} from '@eduplatform/server-kit';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { APP_POOL } from '../../src/db/database.module';
import { ALL_SERVICES } from '../../src/services';
import { startDatabase, type TestDatabase } from '../support/database';

const KEYCLOAK = 'http://keycloak.test';
const AUDIENCE = 'eduplatform-api';
const KNOWN_USER: AuthenticatedIdentity = {
  actorType: 'user',
  userId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e90',
  tenantId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e8f',
};

@Controller('test-login')
class TestLoginController {
  @Get('me')
  @AuthenticatedOnly()
  me() {
    const context = currentContext();
    return { data: { userId: context?.userId, tenantId: context?.tenantId } };
  }

  @Get('guarded')
  @RequireModule('audit')
  @RequirePermission('audit.log.view')
  guarded() {
    return { data: 'secret' };
  }
}

@Module({ controllers: [TestLoginController] })
class TestLoginModule {}

let db: TestDatabase;
let app: NestExpressApplication;
let signToken: (subject: string) => Promise<string>;

beforeAll(async () => {
  db = await startDatabase();

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }],
  });
  signToken = (subject) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject(subject)
      .setIssuer(`${KEYCLOAK}/realms/tenants`)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  // Only the Keycloak subject "known" is an active user in this test.
  const authenticator = new KeycloakAuthenticator(
    new KeycloakTokenVerifier({ keycloakUrl: KEYCLOAK, audience: AUDIENCE, keysFor: () => keys }),
    { resolve: async (token) => (token.subject === 'known' ? KNOWN_USER : null) },
  );

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(ALL_SERVICES), TestLoginModule],
  })
    .overrideProvider(APP_POOL)
    .useValue(createPool(db.url('edu_app'), { max: 2 }))
    .overrideProvider(AUTHENTICATOR)
    .useValue(authenticator)
    .compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, { logger: createLogger('api-test', 'silent'), swaggerEnabled: true });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

describe('HTTP pipeline', () => {
  it('serves liveness and readiness, with a request id', async () => {
    const live = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(live.body).toEqual({ data: { status: 'ok' } });
    expect(live.headers['x-request-id']).toBeTruthy();

    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body.data.checks).toEqual({ database: 'ok' });
  });

  it('keeps a valid incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'client-request-0001');
    expect(res.headers['x-request-id']).toBe('client-request-0001');
  });

  it('answers unknown routes with problem details', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nothing-here').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'not_found' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('serves the OpenAPI contract for Swagger UI', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.paths['/health']).toBeDefined();
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('login checks', () => {
  const server = () => app.getHttpServer();

  it('answers 401 without a token', async () => {
    const res = await request(server()).get('/api/v1/test-login/me').expect(401);
    expect(res.body).toMatchObject({ code: 'unauthenticated' });
  });

  it('answers 401 for a token that is not genuine', async () => {
    const res = await request(server())
      .get('/api/v1/test-login/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
    expect(res.body.detail).toBe('The token is not a valid JWT');
  });

  it('answers 401 for a genuine token of a person who is not an active user', async () => {
    const res = await request(server())
      .get('/api/v1/test-login/me')
      .set('Authorization', `Bearer ${await signToken('stranger')}`)
      .expect(401);
    expect(res.body.detail).toBe('This account is not active in EduPlatform');
  });

  it('lets a known user in and puts the user and tenant in the request context', async () => {
    const res = await request(server())
      .get('/api/v1/test-login/me')
      .set('Authorization', `Bearer ${await signToken('known')}`)
      .expect(200);
    expect(res.body.data).toEqual({ userId: KNOWN_USER.userId, tenantId: KNOWN_USER.tenantId });
  });

  it('still checks module and permission after login (deny by default until Phase 2)', async () => {
    const res = await request(server())
      .get('/api/v1/test-login/guarded')
      .set('Authorization', `Bearer ${await signToken('known')}`)
      .expect(403);
    expect(res.body.code).toBe('module_not_enabled');
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createLogger, createPool } from '@eduplatform/server-kit';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { APP_POOL } from '../../src/db/database.module';
import { ALL_SERVICES } from '../../src/services';
import { startDatabase, type TestDatabase } from '../support/database';

let db: TestDatabase;
let app: NestExpressApplication;

beforeAll(async () => {
  db = await startDatabase();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(ALL_SERVICES)] })
    .overrideProvider(APP_POOL)
    .useValue(createPool(db.url('edu_app'), { max: 2 }))
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

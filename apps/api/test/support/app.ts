/**
 * Starts the real API app for integration tests, wired to the test database and to test
 * login tokens instead of the local Keycloak.
 *
 *   const app = await startTestApp(db, tokens);
 *   await request(app.getHttpServer()).get('/api/v1/health').expect(200);
 *
 * `configure` can add test-only modules or override more providers.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import {
  APP_POOL,
  createLogger,
  createPool,
  PLATFORM_POOL,
  TOKEN_VERIFIER,
} from '@eduplatform/server-kit';
import type { DynamicModule, Type } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { ALL_SERVICES } from '../../src/services';
import type { TestDatabase } from './database';
import type { TestTokens } from './tokens';

export interface TestAppOptions {
  /** Extra modules, e.g. test-only controllers. */
  imports?: Array<Type<unknown> | DynamicModule>;
  /** Further provider overrides. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  swaggerEnabled?: boolean;
}

export async function startTestApp(
  db: TestDatabase,
  tokens: TestTokens,
  options: TestAppOptions = {},
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(ALL_SERVICES), ...(options.imports ?? [])],
  })
    .overrideProvider(APP_POOL)
    .useValue(createPool(db.url('edu_app'), { max: 2 }))
    .overrideProvider(PLATFORM_POOL)
    .useValue(createPool(db.url('edu_platform'), { max: 2 }))
    .overrideProvider(TOKEN_VERIFIER)
    .useValue(tokens.verifier);
  if (options.configure) builder = options.configure(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, {
    logger: createLogger('api-test', 'silent'),
    swaggerEnabled: options.swaggerEnabled ?? false,
  });
  await app.init(); // runs startup work too, e.g. the module catalog sync
  return app;
}

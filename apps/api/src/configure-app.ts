/**
 * The HTTP pipeline every request goes through, in order. Shared by main.ts and the tests,
 * so the tests exercise exactly what production runs.
 *
 *   request
 *     → request context   gives the request an id and a place to store tenant and user
 *     → helmet             security headers
 *     → CORS               only if CORS_ORIGINS lists allowed browser origins
 *     → JSON body parser   at most 1 MB
 *     → AccessGuard        module + permission check (set up in app.module.ts)
 *     → controller
 *     → ProblemFilter      turns any error into an RFC 9457 problem response
 */
import { readFileSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ProblemFilter, requestContextMiddleware } from '@eduplatform/server-kit';
import helmet from 'helmet';
import type { Logger } from 'pino';

export interface ConfigureOptions {
  logger: Logger;
  swaggerEnabled: boolean;
  /** Browser origins allowed to call the API (CORS). Empty = none. */
  corsOrigins?: string[];
}

/** Loads the API contract built by packages/contracts (ADR-0010). */
export function loadOpenApiDocument(): OpenAPIObject {
  const path = require.resolve('@eduplatform/contracts/openapi.json');
  return JSON.parse(readFileSync(path, 'utf8')) as OpenAPIObject;
}

export function configureApp(app: NestExpressApplication, options: ConfigureOptions): void {
  app.use(requestContextMiddleware);
  app.use(helmet());
  if (options.corsOrigins?.length) {
    app.enableCors({
      origin: options.corsOrigins,
      credentials: false, // the API uses bearer tokens, never cookies
      exposedHeaders: [
        'X-Request-Id',
        'ETag',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
      ],
    });
  }
  app.useBodyParser('json', { limit: '1mb' });
  app.disable('x-powered-by');

  // Every endpoint is under /api/v1 (docs/08-api-conventions.md §8.2).
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter(options.logger));
  app.enableShutdownHooks();

  if (options.swaggerEnabled) {
    // Swagger shows the contract file, not decorators on controllers: the contract is the
    // source of truth, and a test checks that the controllers match it.
    SwaggerModule.setup('api/docs', app, loadOpenApiDocument(), {
      jsonDocumentUrl: 'api/docs/openapi.json',
      yamlDocumentUrl: 'api/docs/openapi.yaml',
      swaggerOptions: { persistAuthorization: true, displayOperationId: true },
    });
  }
}

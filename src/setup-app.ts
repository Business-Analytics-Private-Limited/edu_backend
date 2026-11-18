/**
 * Settings that apply to every request. Used by main.ts and by the tests, so the tests run the
 * app exactly as it runs for real.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

export function setupApp(app: INestApplication) {
  // Every route starts with /api/v1, e.g. /api/v1/auth/login
  app.setGlobalPrefix('api/v1');

  // Security headers on every response.
  app.use(helmet());

  // The web apps call the API from their own server and forward the visitor's address in
  // X-Forwarded-For. It is believed only from these addresses, so rate limits and the audit log
  // see the real visitor (ADR-0028). Default: the same machine. On a server, e.g. "10.0.0.5".
  (app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void }).set(
    'trust proxy',
    process.env.TRUST_PROXY ?? 'loopback',
  );

  // Browsers may call the API only from our frontends (CORS_ORIGINS in .env).
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  app.enableCors({ origin: origins });

  // Checks every request body and query against its DTO class:
  //   whitelist            drops fields the DTO doesn't declare
  //   forbidNonWhitelisted  ...and answers 400 if someone sends them anyway
  //   transform            turns "2" into 2 where the DTO says number
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Database errors like "email already used" become clear 409 / 404 answers.
  app.useGlobalFilters(new PrismaExceptionFilter());

  // API documentation, built from the controllers and DTOs:
  //   http://localhost:3000/api/docs        Swagger UI (try every endpoint in the browser)
  //   http://localhost:3000/api/docs-json   the same as JSON: import this URL into Postman
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('EduPlatform API')
      .setDescription(
        'Log in with POST /auth/login (organization users) or /auth/super-admin/login, ' +
          'copy the accessToken, then press "Authorize" and paste it.',
      )
      .setVersion('0.2.0')
      // The address the API is reached at, so Postman's {{baseUrl}} is filled in on import.
      .addServer(
        process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
        'This server',
      )
      .addBearerAuth()
      .build(),
  );
  // persistAuthorization: the token pasted in "Authorize" survives a page reload.
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });
}

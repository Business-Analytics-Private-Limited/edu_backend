/**
 * Starts the API host: `pnpm dev` (watch mode) or `node dist/main.js` (after a build).
 */
import 'reflect-metadata'; // must be first: NestJS reads decorator metadata through it
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger, loadLocalEnv, PinoNestLogger } from '@eduplatform/server-kit';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { configureApp } from './configure-app';
import { selectServices } from './services';

async function bootstrap(): Promise<void> {
  loadLocalEnv(); // reads the repository's .env in development
  const config = loadConfig();
  const logger = createLogger('api', config.LOG_LEVEL);

  // All services, or only those named in ENABLED_SERVICES.
  const services = selectServices(config.ENABLED_SERVICES);

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(services), {
    logger: new PinoNestLogger(logger),
  });
  configureApp(app, {
    logger,
    swaggerEnabled: config.SWAGGER_ENABLED,
    corsOrigins: config.CORS_ORIGINS,
  });

  await app.listen(config.PORT);
  logger.info(
    {
      port: config.PORT,
      services: services.map((s) => s.manifest.key),
      swagger: config.SWAGGER_ENABLED ? '/api/docs' : 'disabled',
    },
    'api started',
  );
}

void bootstrap();

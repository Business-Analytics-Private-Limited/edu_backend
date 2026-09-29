/**
 * Starts the device gateway on port 3002 (PORT to change). Uses the same request-id,
 * security-header and error-format pipeline as the API.
 */
import 'reflect-metadata'; // must be first: NestJS reads decorator metadata through it
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createLogger,
  PinoNestLogger,
  ProblemFilter,
  requestContextMiddleware,
} from '@eduplatform/server-kit';
import helmet from 'helmet';
import { GatewayModule } from './gateway.module';

async function bootstrap(): Promise<void> {
  const logger = createLogger('device-gateway');
  const app = await NestFactory.create<NestExpressApplication>(GatewayModule, {
    logger: new PinoNestLogger(logger),
  });
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.disable('x-powered-by');
  app.useGlobalFilters(new ProblemFilter(logger));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3002);
  await app.listen(port);
  logger.info({ port }, 'device-gateway started');
}

void bootstrap();

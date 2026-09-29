/**
 * Starts the worker: a NestJS app without an HTTP server that runs background work
 * (today: the outbox relay in relay/relay.service.ts).
 */
import 'reflect-metadata'; // must be first: NestJS reads decorator metadata through it
import { NestFactory } from '@nestjs/core';
import { createLogger, loadLocalEnv, PinoNestLogger } from '@eduplatform/server-kit';
import { loadConfig } from './config';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  loadLocalEnv(); // reads the repository's .env in development
  const logger = createLogger('worker', loadConfig().LOG_LEVEL);
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new PinoNestLogger(logger),
  });
  app.enableShutdownHooks();
  logger.info('worker started');
}

void bootstrap();

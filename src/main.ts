/**
 * Starts the API: `pnpm dev` (development, restarts on save) or `pnpm start` (after `pnpm build`).
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`API running on http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`API documentation on http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();

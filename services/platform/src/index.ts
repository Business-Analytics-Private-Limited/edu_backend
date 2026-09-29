/**
 * Entry point of the platform service, imported ONLY by host apps (apps/api).
 * Other services must import '@eduplatform/platform-service/public' instead.
 */
import { join } from 'node:path';
import type { ServiceDefinition } from '@eduplatform/server-kit';
import { platformManifest } from './manifest';
import { PlatformModule } from './platform.module';

export const platformService: ServiceDefinition = {
  manifest: platformManifest,
  module: PlatformModule,
  // __dirname is dist/ after the build, so this points at the package's migrations folder.
  migrationsDir: join(__dirname, '..', 'migrations'),
};

export { platformManifest } from './manifest';

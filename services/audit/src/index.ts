/**
 * Entry point of the audit service, imported ONLY by host apps (apps/api).
 * Other services must import '@eduplatform/audit-service/public' instead.
 *
 * It exports one ServiceDefinition: everything a host needs to run this service.
 */
import { join } from 'node:path';
import type { ServiceDefinition } from '@eduplatform/server-kit';
import { AuditModule } from './audit.module';
import { auditManifest } from './manifest';

export const auditService: ServiceDefinition = {
  manifest: auditManifest,
  module: AuditModule,
  // __dirname is dist/ after the build, so this points at the package's migrations folder.
  migrationsDir: join(__dirname, '..', 'migrations'),
};

export { auditManifest } from './manifest';

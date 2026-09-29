/**
 * THE SERVICES THIS HOST CAN RUN.
 *
 * Every business service lives in its own package under services/ and exports one
 * ServiceDefinition. Adding a service to ALL_SERVICES is all it takes to:
 *   - load its controllers and providers (app.module.ts),
 *   - run its migrations (db/migration-sources.ts),
 *   - include it in the architecture tests.
 *
 * Order matters for migrations: list a service after the services it depends on
 * (docs/02-domain-map.md §2.3).
 *
 * Running only some services: set ENABLED_SERVICES in .env, e.g. ENABLED_SERVICES=students,
 * and start the host with `pnpm dev:api`. See docs/guides/running-one-service.md.
 */
import { auditService } from '@eduplatform/audit-service';
import type { ServiceDefinition } from '@eduplatform/server-kit';

export const ALL_SERVICES: ServiceDefinition[] = [
  auditService,
  // Phase 2: platformService, identityService, accessService, filesService
  // Phase 3: academicService
  // Phase 4: studentsService
  // Phase 5: attendanceService
];

/**
 * Picks the services this process runs.
 *
 * @param enabled service keys from ENABLED_SERVICES, e.g. ['students', 'academic'];
 *                an empty list means every service.
 * @throws when a name is unknown, or when a chosen service depends on a service that exists
 *         but was not chosen (in-process calls to it would fail).
 */
export function selectServices(
  enabled: string[],
  registry: ServiceDefinition[] = ALL_SERVICES,
): ServiceDefinition[] {
  if (enabled.length === 0) return registry;

  const known = new Set(registry.map((s) => s.manifest.key));
  const unknown = enabled.filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown service(s) in ENABLED_SERVICES: ${unknown.join(', ')}. ` +
        `Available: ${[...known].join(', ')}`,
    );
  }

  // Keep the registry order, so dependencies still start first.
  const selected = registry.filter((s) => enabled.includes(s.manifest.key));

  const missing = selected.flatMap((s) =>
    s.manifest.dependsOn
      .filter((dep) => known.has(dep) && !enabled.includes(dep))
      .map((dep) => `${s.manifest.key} needs ${dep}`),
  );
  if (missing.length > 0) {
    throw new Error(
      `ENABLED_SERVICES is missing dependencies (${missing.join('; ')}). ` +
        'Add them to ENABLED_SERVICES.',
    );
  }
  return selected;
}

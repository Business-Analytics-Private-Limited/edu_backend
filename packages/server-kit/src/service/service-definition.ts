/**
 * The one object every backend service exports (ADR-0011).
 *
 * A "service" is one business module (students, attendance, …) packaged in its own folder
 * under services/. The host app (apps/api) receives a list of these objects
 * and does everything else:
 *   - loads each service's NestJS module (its controllers and providers),
 *   - runs each service's migrations in its own database schema,
 *   - reads each manifest for permissions, navigation and events.
 *
 * Today all services run inside the one host process. To run a service as its own
 * microservice later, give it its own small host that registers only that service; the
 * service's code does not change.
 */
import type { Type } from '@nestjs/common';
import type { ModuleManifest } from '@eduplatform/contracts';

export interface ServiceDefinition {
  /**
   * What the service is, which permissions and events it has, and what it depends on.
   * `manifest.key` is also the service's Postgres schema name (CLAUDE.md rule 2).
   */
  manifest: ModuleManifest;

  /** The NestJS module that wires the service's controllers and providers. */
  module: Type<unknown>;

  /** Folder of the service's SQL migrations (files named 0001_name.sql, 0002_…). */
  migrationsDir: string;
}

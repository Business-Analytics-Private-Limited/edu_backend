/**
 * The audit service's manifest: what it is and what it offers.
 *
 * Every service has one. The platform reads it to build the permission catalog, the super
 * admin screens and the sidebar navigation (docs/05-module-catalog.md §5.2).
 * Keep it in sync with the service's documentation: docs/modules/audit.md.
 */
import type { ModuleManifest } from '@eduplatform/contracts';

export const auditManifest: ModuleManifest = {
  // Also the Postgres schema name: this service's tables live in schema "audit".
  key: 'audit',
  name: 'Audit log',
  version: 1,
  category: 'platform',

  // Core services are always enabled for every tenant; the super admin can't switch them off.
  core: true,
  dependsOn: [],
  appliesTo: ['junior_college', 'degree_college', 'engineering_college', 'school'],
  variants: [],

  permissions: [{ key: 'audit.log.view', description: "Read the tenant's audit log within scope" }],

  // Audit neither publishes nor consumes events: other services write to it directly, inside
  // their own transaction, using recordAudit() from @eduplatform/server-kit.
  events: { publishes: [], consumes: [] },

  navigation: [{ path: '/audit', label: 'Audit log', permission: 'audit.log.view' }],
};

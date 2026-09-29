/**
 * The platform service's manifest (docs/05-module-catalog.md §5.2). Keep it in sync with
 * docs/modules/platform.md.
 */
import type { ModuleManifest } from '@eduplatform/contracts';

export const platformManifest: ModuleManifest = {
  // Also the Postgres schema name: this service's tables live in schema "platform".
  key: 'platform',
  name: 'Organization',
  version: 1,
  category: 'platform',
  core: true, // always enabled for every tenant
  dependsOn: [],
  appliesTo: ['junior_college', 'degree_college', 'engineering_college', 'school'],
  variants: [],
  permissions: [
    {
      key: 'platform.institution.view',
      description: 'See the organization, its institutions and campuses',
    },
    { key: 'platform.institution.manage', description: 'Create, edit and deactivate institutions' },
    { key: 'platform.campus.manage', description: 'Create, edit and deactivate campuses' },
    { key: 'platform.settings.manage', description: 'Change module settings and variant choices' },
  ],
  events: {
    publishes: [
      'platform.tenant.created',
      'platform.tenant.status_changed',
      'platform.institution.changed',
      'platform.module.enabled',
      'platform.module.disabled',
    ],
    consumes: [],
  },
  navigation: [
    { path: '/organization', label: 'Organization', permission: 'platform.institution.view' },
  ],
};

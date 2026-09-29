/**
 * Module manifest (docs/05-module-catalog.md §5.2). The single source for backend guards,
 * the super admin screens, tenant settings screens and frontend navigation.
 */
export type InstitutionType =
  'junior_college' | 'degree_college' | 'engineering_college' | 'school';

export type ScopeType = 'organization' | 'institution' | 'campus' | 'node' | 'self' | 'guardian';

export interface ModuleVariant {
  key: string;
  name: string;
  default?: boolean;
  status?: 'available' | 'planned' | 'retired';
  /** JSON Schema for variant-specific settings. */
  settingsSchema?: Record<string, unknown>;
}

export interface ModulePermission {
  key: string;
  description: string;
}

export interface NavigationItem {
  path: string;
  label: string;
  permission: string;
  variant?: string;
}

export interface ModuleLimit {
  key: string;
  default: number;
}

export interface ModuleManifest {
  key: string;
  name: string;
  version: number;
  category:
    'platform' | 'academics' | 'administration' | 'finance' | 'communication' | 'supporting';
  /** Always enabled for every tenant (platform, identity, access, audit, files). */
  core?: boolean;
  dependsOn: string[];
  appliesTo: InstitutionType[];
  variants: ModuleVariant[];
  variantSelection?: 'single' | 'multiple';
  settingsSchema?: Record<string, unknown>;
  limits?: ModuleLimit[];
  permissions: ModulePermission[];
  events: { publishes: string[]; consumes: string[] };
  navigation?: NavigationItem[];
}

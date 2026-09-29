/**
 * Drizzle descriptions of the platform tables, so queries are typed (ADR-0002).
 *
 * The migrations in ../../migrations are the source of truth for the database. This file
 * only mirrors the columns the code uses: when you add a column in a migration, add it here.
 */
import {
  boolean,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const platform = pgSchema('platform');

/** Timestamps are timestamptz in UTC (CLAUDE.md rule 5). */
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export interface ContactJson {
  name: string;
  phone?: string;
  email?: string;
}

export const platformUsers = platform.table('platform_users', {
  id: uuid('id').primaryKey(),
  keycloakSub: text('keycloak_sub').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role').$type<'platform_owner' | 'platform_admin' | 'platform_support'>().notNull(),
  status: text('status').$type<'active' | 'disabled'>().notNull(),
});

export const modules = platform.table('modules', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  manifestVersion: integer('manifest_version').notNull(),
  dependsOn: text('depends_on').array().notNull(),
  appliesTo: text('applies_to').array().notNull(),
  isCore: boolean('is_core').notNull(),
  status: text('status').$type<'available' | 'planned' | 'retired'>().notNull(),
  manifest: jsonb('manifest').notNull(),
  syncedAt: at('synced_at').notNull().defaultNow(),
});

export const moduleVariants = platform.table(
  'module_variants',
  {
    moduleKey: text('module_key').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull(),
    status: text('status').$type<'available' | 'planned' | 'retired'>().notNull(),
    settingsSchema: jsonb('settings_schema'),
  },
  (t) => [primaryKey({ columns: [t.moduleKey, t.key] })],
);

export const tenants = platform.table('tenants', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  legalName: text('legal_name').notNull(),
  displayName: text('display_name').notNull(),
  keycloakOrgId: text('keycloak_org_id'),
  planId: uuid('plan_id'),
  status: text('status')
    .$type<'onboarding' | 'active' | 'suspended' | 'closed'>()
    .notNull()
    .default('onboarding'),
  statusReason: text('status_reason'),
  branding: jsonb('branding').notNull().default({}),
  primaryContact: jsonb('primary_contact').$type<ContactJson | null>(),
  createdAt: at('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: at('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export const tenantPlacements = platform.table('tenant_placements', {
  tenantId: uuid('tenant_id').primaryKey(),
  clusterKey: text('cluster_key').notNull(),
  databaseName: text('database_name').notNull(),
});

export const institutions = platform.table('institutions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  shortName: text('short_name'),
  type: text('type')
    .$type<'junior_college' | 'degree_college' | 'engineering_college' | 'school'>()
    .notNull(),
  structureTemplateKey: text('structure_template_key').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  locale: text('locale').notNull().default('en-IN'),
  currency: text('currency').notNull().default('INR'),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
  deletedAt: at('deleted_at'),
});

export const campuses = platform.table('campuses', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  institutionId: uuid('institution_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  deletedAt: at('deleted_at'),
});

export const tenantEntitlements = platform.table('tenant_entitlements', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  moduleKey: text('module_key').notNull(),
  enabled: boolean('enabled').notNull(),
  allowedVariants: text('allowed_variants').array().notNull(),
  limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
  startsAt: at('starts_at').notNull().defaultNow(),
  endsAt: at('ends_at'),
  source: text('source').$type<'plan' | 'override' | 'core'>().notNull(),
  readOnlyUntil: at('read_only_until'),
  createdBy: uuid('created_by'),
  updatedAt: at('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  version: integer('version').notNull().default(1),
});

export type TenantRow = typeof tenants.$inferSelect;
export type InstitutionRow = typeof institutions.$inferSelect;
export type CampusRow = typeof campuses.$inferSelect;
export type EntitlementRow = typeof tenantEntitlements.$inferSelect;
export type ModuleRow = typeof modules.$inferSelect;
export type ModuleVariantRow = typeof moduleVariants.$inferSelect;

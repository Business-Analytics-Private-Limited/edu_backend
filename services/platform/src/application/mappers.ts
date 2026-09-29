/**
 * Turns database rows into the response shapes of the API contract.
 *
 * The types come from the contract itself (packages/contracts/openapi/platform.yaml), so if a
 * response here stops matching the documented shape, TypeScript fails the build.
 */
import type { components } from '@eduplatform/contracts';
import type { ModuleManifest } from '@eduplatform/contracts';
import type {
  CampusRow,
  EntitlementRow,
  InstitutionRow,
  ModuleRow,
  ModuleVariantRow,
  TenantRow,
} from '../infrastructure/schema';

export type TenantDto = components['schemas']['Tenant'];
export type TenantDetailDto = components['schemas']['TenantDetail'];
export type InstitutionDto = components['schemas']['Institution'];
export type EntitlementDto = components['schemas']['Entitlement'];
export type ModuleDto = components['schemas']['Module'];
export type OrganizationDto = components['schemas']['Organization'];

const iso = (date: Date | null) => (date ? date.toISOString() : null);

export function toTenantDto(row: TenantRow): TenantDto {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legalName,
    displayName: row.displayName,
    status: row.status,
    statusReason: row.statusReason,
    keycloakOrgId: row.keycloakOrgId,
    primaryContact: row.primaryContact ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function toInstitutionDto(row: InstitutionRow, campuses: CampusRow[]): InstitutionDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    shortName: row.shortName,
    type: row.type,
    structureTemplateKey: row.structureTemplateKey,
    timezone: row.timezone,
    locale: row.locale,
    currency: row.currency,
    status: row.status,
    campuses: campuses
      .filter((c) => c.institutionId === row.id)
      .map((c) => ({ id: c.id, code: c.code, name: c.name, status: c.status })),
  };
}

export function toEntitlementDto(row: EntitlementRow, moduleName: string): EntitlementDto {
  return {
    moduleKey: row.moduleKey,
    moduleName,
    enabled: row.enabled,
    allowedVariants: row.allowedVariants,
    limits: row.limits,
    startsAt: row.startsAt.toISOString(),
    endsAt: iso(row.endsAt),
    source: row.source,
    readOnlyUntil: iso(row.readOnlyUntil),
    version: row.version,
  };
}

export function toModuleDto(row: ModuleRow, variants: ModuleVariantRow[]): ModuleDto {
  const manifest = row.manifest as ModuleManifest;
  return {
    key: row.key,
    name: row.name,
    category: row.category,
    isCore: row.isCore,
    dependsOn: row.dependsOn,
    appliesTo: row.appliesTo,
    status: row.status,
    variants: variants
      .filter((v) => v.moduleKey === row.key)
      .map((v) => ({ key: v.key, name: v.name, isDefault: v.isDefault, status: v.status })),
    permissions: manifest.permissions ?? [],
  };
}

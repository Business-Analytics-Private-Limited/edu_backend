/**
 * The platform service's PUBLIC interface: the only file other services and the host may import
 * ('@eduplatform/platform-service/public'). Everything else in this package is internal.
 *
 * Other code receives the facade by injection:
 *
 *   constructor(@Inject(PLATFORM_FACADE) private readonly platform: PlatformFacade) {}
 *   if (await this.platform.isModuleEnabled(tenantId, 'students')) { … }
 */
import type { ModuleManifest } from '@eduplatform/contracts';

export type StaffRole = 'platform_owner' | 'platform_admin' | 'platform_support';
export type TenantStatus = 'onboarding' | 'active' | 'suspended' | 'closed';

export interface TenantSummary {
  id: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
}

export interface PlatformFacade {
  /**
   * Check 1 of doc 4 §4.1: is the module granted to the tenant and enabled right now?
   * Cached for 60 seconds; changes made through this process are seen at once (ADR-0014).
   */
  isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean>;

  /** The active platform staff member with this Keycloak account (realm "platform"), if any. */
  findActiveStaff(keycloakSubject: string): Promise<{ id: string; role: StaffRole } | null>;

  /** Whether a platform staff member's role allows a super admin permission (admin.*). */
  staffHasPermission(staffId: string, permission: string): Promise<boolean>;

  getTenant(tenantId: string): Promise<TenantSummary | null>;

  /** Tenants are known to Keycloak by their slug (the organization alias). */
  findTenantBySlug(slug: string): Promise<TenantSummary | null>;
}

/** Injection token for PlatformFacade. */
export const PLATFORM_FACADE = Symbol.for('eduplatform.PLATFORM_FACADE');

/**
 * Injection token for the manifests of every service the host runs. The host provides it; the
 * platform service syncs them into the module catalog at startup.
 */
export const MODULE_MANIFESTS = Symbol.for('eduplatform.MODULE_MANIFESTS');
export type ModuleManifests = ModuleManifest[];

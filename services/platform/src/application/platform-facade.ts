/**
 * The implementation of PlatformFacade (see ../public): what other services and the host may
 * ask the platform service. It only delegates to the application services.
 */
import { Injectable } from '@nestjs/common';
import type { PlatformFacade, StaffRole, TenantSummary } from '../public';
import { EntitlementsService } from './entitlements.service';
import { OrganizationService } from './organization.service';
import { StaffService } from './staff.service';

@Injectable()
export class PlatformFacadeService implements PlatformFacade {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly staff: StaffService,
    private readonly organizations: OrganizationService,
  ) {}

  isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    return this.entitlements.isModuleEnabled(tenantId, moduleKey);
  }

  findActiveStaff(keycloakSubject: string): Promise<{ id: string; role: StaffRole } | null> {
    return this.staff.findActive(keycloakSubject);
  }

  staffHasPermission(staffId: string, permission: string): Promise<boolean> {
    return this.staff.hasPermission(staffId, permission);
  }

  getTenant(tenantId: string): Promise<TenantSummary | null> {
    return this.organizations.getSummary(tenantId);
  }

  findTenantBySlug(slug: string): Promise<TenantSummary | null> {
    return this.organizations.findBySlug(slug);
  }
}

/**
 * Tenant-side endpoints: the signed-in user's organization and its enabled modules.
 *   GET /api/v1/platform/organization
 *   GET /api/v1/platform/entitlements
 * Contract: packages/contracts/openapi/platform.yaml (tag "platform").
 */
import { Controller, Get } from '@nestjs/common';
import { AuthenticatedOnly, RequireModule, RequirePermission } from '@eduplatform/server-kit';
import { EntitlementsService } from '../application/entitlements.service';
import { OrganizationService } from '../application/organization.service';

@Controller('platform')
@RequireModule('platform')
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('organization')
  @AuthenticatedOnly()
  async organization() {
    return { data: await this.organizations.current() };
  }

  @Get('entitlements')
  @RequirePermission('platform.institution.view')
  async enabledModules() {
    return { data: await this.entitlements.listEnabledForCurrentTenant() };
  }
}

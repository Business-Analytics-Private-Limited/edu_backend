/**
 * Super admin endpoints for modules: the catalog, and granting modules to organizations.
 *   GET    /api/v1/admin/modules
 *   GET    /api/v1/admin/tenants/:tenantId/entitlements
 *   PUT    /api/v1/admin/tenants/:tenantId/entitlements/:moduleKey
 *   DELETE /api/v1/admin/tenants/:tenantId/entitlements/:moduleKey
 * Contract: packages/contracts/openapi/platform.yaml (tag "admin").
 */
import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import {
  parseInput,
  PlatformEndpoint,
  RequireModule,
  RequirePermission,
  UuidPipe,
} from '@eduplatform/server-kit';
import { CatalogService } from '../application/catalog.service';
import { EntitlementsService } from '../application/entitlements.service';
import { moduleKeySchema, putEntitlementSchema } from './requests';

@Controller('admin')
@PlatformEndpoint()
@RequireModule('platform')
export class AdminEntitlementsController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly entitlements: EntitlementsService,
  ) {}

  @Get('modules')
  @RequirePermission('admin.tenant.view')
  async modules() {
    return { data: await this.catalog.list() };
  }

  @Get('tenants/:tenantId/entitlements')
  @RequirePermission('admin.tenant.view')
  async list(@Param('tenantId', UuidPipe) tenantId: string) {
    return { data: await this.entitlements.listForTenant(tenantId) };
  }

  @Put('tenants/:tenantId/entitlements/:moduleKey')
  @RequirePermission('admin.entitlement.manage')
  async put(
    @Param('tenantId', UuidPipe) tenantId: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: unknown,
  ) {
    const key = parseInput(moduleKeySchema, moduleKey);
    return {
      data: await this.entitlements.put(tenantId, key, parseInput(putEntitlementSchema, body)),
    };
  }

  @Delete('tenants/:tenantId/entitlements/:moduleKey')
  @RequirePermission('admin.entitlement.manage')
  async disable(
    @Param('tenantId', UuidPipe) tenantId: string,
    @Param('moduleKey') moduleKey: string,
  ) {
    const key = parseInput(moduleKeySchema, moduleKey);
    return { data: await this.entitlements.disable(tenantId, key) };
  }
}

/**
 * NestJS wiring of the platform service: its controllers, its application services, and the
 * facade it offers to the host and other services (PLATFORM_FACADE).
 *
 * Needs from the host: APP_POOL, PLATFORM_POOL (database) and MODULE_MANIFESTS (catalog).
 */
import { Module } from '@nestjs/common';
import { CatalogService } from './application/catalog.service';
import { EntitlementsService } from './application/entitlements.service';
import { OrganizationService } from './application/organization.service';
import { PlatformFacadeService } from './application/platform-facade';
import { StaffService } from './application/staff.service';
import { TenantsService } from './application/tenants.service';
import { AdminEntitlementsController } from './http/admin-entitlements.controller';
import { AdminTenantsController } from './http/admin-tenants.controller';
import { OrganizationController } from './http/organization.controller';
import { PLATFORM_FACADE } from './public';

@Module({
  controllers: [AdminTenantsController, AdminEntitlementsController, OrganizationController],
  providers: [
    CatalogService,
    TenantsService,
    EntitlementsService,
    StaffService,
    OrganizationService,
    { provide: PLATFORM_FACADE, useClass: PlatformFacadeService },
  ],
  exports: [PLATFORM_FACADE],
})
export class PlatformModule {}

import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module';
import { OrganizationsService } from './organizations.service';
import { PlatformAuditController } from './platform-audit.controller';
import { SuperAdminController } from './super-admin.controller';

/** The super admin area: organizations, their modules and branches, and the audit log. */
@Module({
  imports: [RolesModule],
  controllers: [SuperAdminController, PlatformAuditController],
  providers: [OrganizationsService],
})
export class SuperAdminModule {}

import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { SuperAdminController } from './super-admin.controller';

/** The super admin area: organizations and their modules. */
@Module({
  controllers: [SuperAdminController],
  providers: [OrganizationsService],
})
export class SuperAdminModule {}

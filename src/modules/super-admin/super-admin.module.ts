import { Module } from '@nestjs/common';
import { RolesModule } from '../roles/roles.module';
import { OrganizationsService } from './organizations.service';
import { SuperAdminController } from './super-admin.controller';

/** The super admin area: organizations and their modules. */
@Module({
  imports: [RolesModule],
  controllers: [SuperAdminController],
  providers: [OrganizationsService],
})
export class SuperAdminModule {}

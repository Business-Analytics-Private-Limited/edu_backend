import { Module } from '@nestjs/common';
import { PredefinedRolesController } from './predefined-roles.controller';
import { PredefinedRolesService } from './predefined-roles.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Roles and permissions: an organization's roles (RolesController) and the predefined roles
 * the super admin manages (PredefinedRolesController).
 * PredefinedRolesService is exported so a new organization gets its copies of them.
 */
@Module({
  controllers: [RolesController, PredefinedRolesController],
  providers: [RolesService, PredefinedRolesService],
  exports: [PredefinedRolesService],
})
export class RolesModule {}

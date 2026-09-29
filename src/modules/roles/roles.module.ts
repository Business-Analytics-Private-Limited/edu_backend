import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/** Roles of an organization and the permission list. */
@Module({
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}

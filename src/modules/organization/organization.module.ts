import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

/** The tenant admin area: own organization, dashboard, institutions, campuses. */
@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService],
})
export class OrganizationModule {}

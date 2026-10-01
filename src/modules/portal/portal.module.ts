import { Module } from '@nestjs/common';
import { PortalAccessService } from './portal-access.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

/** The parent and student portal (ADR-0022): portal logins and what they may see. */
@Module({
  controllers: [PortalController],
  providers: [PortalService, PortalAccessService],
})
export class PortalModule {}

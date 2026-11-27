import { Module } from '@nestjs/common';
import { EvaluationModule } from '../evaluation/evaluation.module';
import { PortalAccessService } from './portal-access.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

/** The parent and student portal (ADR-0022): portal logins and what they may see. */
@Module({
  // Results and report cards of locked exams (ADR-0037).
  imports: [EvaluationModule],
  controllers: [PortalController],
  providers: [PortalService, PortalAccessService],
})
export class PortalModule {}

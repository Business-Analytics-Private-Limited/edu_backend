import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { EnrolmentsService } from './enrolments.service';
import { GuardiansService } from './guardians.service';
import { ImportService } from './import.service';
import { PromotionsService } from './promotions.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/**
 * The Students module (ADR-0020): admission, profile, status, guardians, enrolments, promotion
 * and shuffle.
 */
@Module({
  controllers: [StudentsController, DocumentsController],
  providers: [
    StudentsService,
    GuardiansService,
    EnrolmentsService,
    PromotionsService,
    ImportService,
    DocumentsService,
  ],
})
export class StudentsModule {}

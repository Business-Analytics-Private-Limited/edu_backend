import { Module } from '@nestjs/common';
import { EnrolmentsService } from './enrolments.service';
import { GuardiansService } from './guardians.service';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';

/** The Students module (ADR-0020): admission, profile, status, guardians, enrolments. */
@Module({
  controllers: [StudentsController],
  providers: [StudentsService, GuardiansService, EnrolmentsService],
})
export class StudentsModule {}

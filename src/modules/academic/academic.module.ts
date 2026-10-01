import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { AcademicYearsService } from './academic-years.service';
import { BatchesService } from './batches.service';
import { CalendarService } from './calendar.service';
import { ClassStructureService } from './class-structure.service';
import { SubjectsCalendarController } from './subjects-calendar.controller';
import { SubjectsService } from './subjects.service';

/**
 * The Academic module (ADR-0019): academic years, class levels and classes, batches, subjects,
 * and the calendar (weekly off days, holidays).
 */
@Module({
  controllers: [AcademicController, SubjectsCalendarController],
  providers: [
    AcademicYearsService,
    ClassStructureService,
    BatchesService,
    SubjectsService,
    CalendarService,
  ],
})
export class AcademicModule {}

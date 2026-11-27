import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { AcademicYearsService } from './academic-years.service';
import { CalendarService } from './calendar.service';
import { ChaptersService } from './chapters.service';
import { StructureService } from './structure.service';
import { SubjectsCalendarController } from './subjects-calendar.controller';
import { SubjectsService } from './subjects.service';

/**
 * The Academic module (ADR-0019, ADR-0030): academic years, the academic structure (classes,
 * groups, streams, courses and each branch's sections), subjects, and the calendar (weekly off
 * days, holidays).
 */
@Module({
  controllers: [AcademicController, SubjectsCalendarController],
  providers: [
    AcademicYearsService,
    StructureService,
    SubjectsService,
    CalendarService,
    ChaptersService,
  ],
})
export class AcademicModule {}

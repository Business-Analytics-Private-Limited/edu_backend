import { Module } from '@nestjs/common';
import { AcademicController } from './academic.controller';
import { AcademicYearsService } from './academic-years.service';
import { BatchesService } from './batches.service';
import { ClassStructureService } from './class-structure.service';

/** The Academic module: academic years, class levels and classes, batches (ADR-0019). */
@Module({
  controllers: [AcademicController],
  providers: [AcademicYearsService, ClassStructureService, BatchesService],
})
export class AcademicModule {}

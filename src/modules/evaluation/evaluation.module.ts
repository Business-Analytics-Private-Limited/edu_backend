import { Module } from '@nestjs/common';
import { EvaluationController } from './evaluation.controller';
import { ExamTypesService } from './exam-types.service';
import { ExamsService } from './exams.service';
import { MarksService } from './marks.service';

/**
 * The Evaluation module (ADR-0035): exam types, exams with subjects, marks entry and CSV upload,
 * results. Its tables keep other modules' records as plain ids, so it can become its own service.
 */
@Module({
  controllers: [EvaluationController],
  providers: [ExamTypesService, ExamsService, MarksService],
})
export class EvaluationModule {}

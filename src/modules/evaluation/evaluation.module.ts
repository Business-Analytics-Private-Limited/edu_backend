import { Module } from '@nestjs/common';
import { EvaluationController } from './evaluation.controller';
import { ExamTypesService } from './exam-types.service';
import { ExamsService } from './exams.service';
import { GradingSchemesService } from './grading-schemes.service';
import { MarksService } from './marks.service';
import { OverviewService } from './overview.service';
import { ReportCardsService } from './report-cards.service';

/**
 * The Evaluation module (ADR-0035): exam types, exams with subjects, marks entry and CSV upload,
 * results; part 2 (ADR-0036): grading schemes, report cards, overviews. Its tables keep other modules' records as plain ids, so it can become its own service.
 */
@Module({
  controllers: [EvaluationController],
  providers: [
    ExamTypesService,
    ExamsService,
    MarksService,
    GradingSchemesService,
    ReportCardsService,
    OverviewService,
  ],
  // The portal shows results and report cards to parents and students (ADR-0036).
  exports: [ReportCardsService],
})
export class EvaluationModule {}

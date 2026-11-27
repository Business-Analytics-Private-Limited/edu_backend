/**
 * THE EVALUATION MODULE, part 1 (ADR-0035): exam types, exams with subjects, marks entry and CSV
 * upload, results. Works only when the Evaluation module is switched on. The services check each
 * permission again at the exam's / section's / student's branch.
 *
 *   GET    /api/v1/exam-types                          evaluation.exam.view
 *   POST   /api/v1/exam-types                          evaluation.settings.update (organization)
 *   PATCH  /api/v1/exam-types/:id                      evaluation.settings.update
 *   DELETE /api/v1/exam-types/:id                      evaluation.settings.update
 *
 *   GET    /api/v1/exams?academicYearId=&branchId=&examTypeId=&status=   evaluation.exam.view
 *   GET    /api/v1/exams/subject-options?classId=&branchId=  evaluation.exam.create
 *   POST   /api/v1/exams                               evaluation.exam.create
 *   GET    /api/v1/exams/:id                           evaluation.exam.view
 *   PATCH  /api/v1/exams/:id                           evaluation.exam.update
 *   DELETE /api/v1/exams/:id                           evaluation.exam.delete (only without marks)
 *   POST   /api/v1/exams/:id/lock | /unlock            evaluation.exam.update
 *
 *   GET    /api/v1/exams/:id/marks?sectionId=          evaluation.marks.view   (a section's grid)
 *   PUT    /api/v1/exams/:id/marks                     evaluation.marks.enter  (save by hand)
 *   POST   /api/v1/exams/:id/marks/upload              evaluation.marks.import (CSV rows; dryRun = check)
 *   GET    /api/v1/exams/:id/results?sectionId=        evaluation.marks.view
 *   GET    /api/v1/exams/:id/uploads                   evaluation.marks.view
 *   GET    /api/v1/marks-uploads/:id                   evaluation.marks.view
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import {
  CreateExamDto,
  CreateExamTypeDto,
  ExamsQuery,
  OptionalSectionQuery,
  SaveMarksDto,
  SectionQuery,
  SubjectOptionsQuery,
  UpdateExamDto,
  UpdateExamTypeDto,
  UploadMarksDto,
} from './dto/evaluation.dto';
import { ExamTypesService } from './exam-types.service';
import { ExamsService } from './exams.service';
import { MarksService } from './marks.service';

@ApiTags('Evaluation')
@ApiBearerAuth()
@Controller()
export class EvaluationController {
  constructor(
    private readonly types: ExamTypesService,
    private readonly exams: ExamsService,
    private readonly marks: MarksService,
  ) {}

  // --- exam types ----------------------------------------------------------------------------------

  @Get('exam-types')
  @RequirePermission('evaluation.exam.view')
  listTypes(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.types.list(organizationId, user);
  }

  @Post('exam-types')
  @RequirePermission('evaluation.settings.update')
  createType(
    @OrganizationId() organizationId: string,
    @Body() body: CreateExamTypeDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.types.create(organizationId, body, user);
  }

  @Patch('exam-types/:id')
  @RequirePermission('evaluation.settings.update')
  updateType(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateExamTypeDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.types.update(organizationId, id, body, user);
  }

  @Delete('exam-types/:id')
  @RequirePermission('evaluation.settings.update')
  deleteType(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.types.delete(organizationId, id, user);
  }

  // --- exams ---------------------------------------------------------------------------------------

  @Get('exams')
  @RequirePermission('evaluation.exam.view')
  listExams(
    @OrganizationId() organizationId: string,
    @Query() query: ExamsQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.list(organizationId, query, user);
  }

  /** The subjects of the chosen part of the structure, for the New exam form. */
  @Get('exams/subject-options')
  @RequirePermission('evaluation.exam.create')
  subjectOptions(
    @OrganizationId() organizationId: string,
    @Query() query: SubjectOptionsQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.subjectOptions(organizationId, query, user);
  }

  @Post('exams')
  @RequirePermission('evaluation.exam.create')
  createExam(
    @OrganizationId() organizationId: string,
    @Body() body: CreateExamDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.create(organizationId, body, user);
  }

  @Get('exams/:id')
  @RequirePermission('evaluation.exam.view')
  getExam(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.get(organizationId, id, user);
  }

  @Patch('exams/:id')
  @RequirePermission('evaluation.exam.update')
  updateExam(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateExamDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.update(organizationId, id, body, user);
  }

  @Delete('exams/:id')
  @RequirePermission('evaluation.exam.delete')
  deleteExam(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.delete(organizationId, id, user);
  }

  @Post('exams/:id/lock')
  @RequirePermission('evaluation.exam.update')
  @HttpCode(200)
  lock(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.setStatus(organizationId, id, 'LOCKED', user);
  }

  @Post('exams/:id/unlock')
  @RequirePermission('evaluation.exam.update')
  @HttpCode(200)
  unlock(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.exams.setStatus(organizationId, id, 'OPEN', user);
  }

  // --- marks ---------------------------------------------------------------------------------------

  @Get('exams/:id/marks')
  @RequirePermission('evaluation.marks.view')
  grid(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SectionQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.marks.grid(organizationId, id, query.sectionId, user);
  }

  @Put('exams/:id/marks')
  @RequirePermission('evaluation.marks.enter')
  saveMarks(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SaveMarksDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.marks.save(organizationId, id, body, user);
  }

  @Post('exams/:id/marks/upload')
  @RequirePermission('evaluation.marks.import')
  @HttpCode(200)
  upload(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UploadMarksDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.marks.upload(organizationId, id, body, user);
  }

  @Get('exams/:id/results')
  @RequirePermission('evaluation.marks.view')
  results(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: OptionalSectionQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.marks.results(organizationId, id, query.sectionId, user);
  }

  @Get('exams/:id/uploads')
  @RequirePermission('evaluation.marks.view')
  uploads(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.marks.listUploads(organizationId, id, user);
  }

  @Get('marks-uploads/:id')
  @RequirePermission('evaluation.marks.view')
  getUpload(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.marks.getUpload(organizationId, id, user);
  }
}

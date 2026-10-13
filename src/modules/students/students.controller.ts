/**
 * THE STUDENTS MODULE: admission, profile, leaving and re-admission, section and branch changes,
 * guardians, placements, promotion, import and admission numbers (ADR-0020, ADR-0030).
 * Works only when the super admin has switched the Students module on for the organization.
 * Every action is checked at the student's branch (see the services).
 *
 *   GET    /api/v1/students?search=&branchId=&classId=&academicYearId=&show=&status=   students.student.view
 *   POST   /api/v1/students                                    students.student.create  (admission)
 *   GET    /api/v1/students/:id                                students.student.view    (profile + timeline)
 *   PATCH  /api/v1/students/:id                                students.student.update
 *   POST   /api/v1/students/:id/leave                          students.student.update  (becomes outgoing)
 *   POST   /api/v1/students/:id/readmit                        students.student.update
 *   POST   /api/v1/students/:id/change-section                 students.enrolment.transfer
 *   POST   /api/v1/students/:id/change-branch                  students.enrolment.transfer (both branches)
 *   DELETE /api/v1/students/:id                                students.student.delete  (mistakes only)
 *
 *   GET    /api/v1/guardians?phone=                            students.student.view
 *   POST   /api/v1/students/:id/guardians                      students.student.update
 *   PATCH  /api/v1/students/:id/guardians/:guardianId          students.student.update
 *   DELETE /api/v1/students/:id/guardians/:guardianId          students.student.update
 *
 *   POST   /api/v1/students/:id/enrolments                     students.student.update  (place in a section)
 *   PATCH  /api/v1/students/:id/enrolments/:enrolmentId        students.student.update  (roll number)
 *
 *   GET    /api/v1/promotions/preview?branchId=&fromYearId=&toYearId=   students.enrolment.promote
 *   POST   /api/v1/promotions                                  students.enrolment.promote
 *   GET    /api/v1/promotions?branchId=                        students.enrolment.promote (newest first)
 *   POST   /api/v1/promotions/:id/undo                         students.enrolment.promote
 *
 *   POST   /api/v1/students/import                             students.student.import (dryRun to check)
 *   GET    /api/v1/students/imports[/:id]                      students.student.import (import records)
 *   PUT    /api/v1/organization/admission-numbering            students.settings.update (organization)
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
  AdmitStudentDto,
  ApplyPromotionDto,
  BranchQuery,
  ChangeBranchDto,
  ChangeSectionDto,
  EnrolmentDto,
  GuardianDto,
  GuardianSearchQuery,
  ImportRunsQuery,
  ImportStudentsDto,
  LeaveDto,
  ListStudentsQuery,
  PromotionQuery,
  ReadmitDto,
  SetNumberingDto,
  UpdateEnrolmentDto,
  UpdateGuardianDto,
  UpdateStudentDto,
} from './dto/student.dto';
import { EnrolmentsService } from './enrolments.service';
import { GuardiansService } from './guardians.service';
import { ImportService } from './import.service';
import { PromotionsService } from './promotions.service';
import { StudentsService } from './students.service';

@ApiTags('Students')
@ApiBearerAuth()
@Controller()
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly guardians: GuardiansService,
    private readonly enrolments: EnrolmentsService,
    private readonly promotions: PromotionsService,
    private readonly importer: ImportService,
  ) {}

  // --- Students ----------------------------------------------------------------------------------

  @Get('students')
  @RequirePermission('students.student.view')
  list(
    @OrganizationId() organizationId: string,
    @Query() query: ListStudentsQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.list(organizationId, query, user);
  }

  @Post('students')
  @RequirePermission('students.student.create')
  admit(
    @OrganizationId() organizationId: string,
    @Body() body: AdmitStudentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.admit(organizationId, body, user);
  }

  // Before 'students/:id', so "import" isn't read as an id.
  @Post('students/import')
  @RequirePermission('students.student.import')
  @HttpCode(200)
  importStudents(
    @OrganizationId() organizationId: string,
    @Body() body: ImportStudentsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.importer.importStudents(organizationId, body, user);
  }

  /** Import records (IMP-0001 ...), newest first; only where the user may import. */
  @Get('students/imports')
  @RequirePermission('students.student.import')
  listImports(
    @OrganizationId() organizationId: string,
    @Query() query: ImportRunsQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.importer.listRuns(organizationId, query, user);
  }

  /** One import: counts, excluded rows with reasons, the students it admitted. */
  @Get('students/imports/:id')
  @RequirePermission('students.student.import')
  getImport(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.importer.getRun(organizationId, id, user);
  }

  @Get('students/:id')
  @RequirePermission('students.student.view')
  get(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.get(organizationId, id, user);
  }

  @Patch('students/:id')
  @RequirePermission('students.student.update')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStudentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.update(organizationId, id, body, user);
  }

  @Post('students/:id/leave')
  @RequirePermission('students.student.update')
  @HttpCode(200)
  leave(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LeaveDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.leave(organizationId, id, body, user);
  }

  @Post('students/:id/readmit')
  @RequirePermission('students.student.update')
  @HttpCode(200)
  readmit(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReadmitDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.readmit(organizationId, id, body, user);
  }

  @Post('students/:id/change-section')
  @RequirePermission('students.enrolment.transfer')
  @HttpCode(200)
  changeSection(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeSectionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.changeSection(organizationId, id, body, user);
  }

  @Post('students/:id/change-branch')
  @RequirePermission('students.enrolment.transfer')
  @HttpCode(200)
  changeBranch(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeBranchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.changeBranch(organizationId, id, body, user);
  }

  @Delete('students/:id')
  @RequirePermission('students.student.delete')
  delete(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.delete(organizationId, id, user);
  }

  // --- Guardians ---------------------------------------------------------------------------------

  @Get('guardians')
  @RequirePermission('students.student.view')
  searchGuardians(
    @OrganizationId() organizationId: string,
    @Query() query: GuardianSearchQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guardians.search(organizationId, query.phone, user);
  }

  @Post('students/:id/guardians')
  @RequirePermission('students.student.update')
  addGuardian(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GuardianDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guardians.add(organizationId, id, body, user);
  }

  @Patch('students/:id/guardians/:guardianId')
  @RequirePermission('students.student.update')
  updateGuardian(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @Body() body: UpdateGuardianDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guardians.update(organizationId, id, guardianId, body, user);
  }

  @Delete('students/:id/guardians/:guardianId')
  @RequirePermission('students.student.update')
  removeGuardian(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('guardianId', ParseUUIDPipe) guardianId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.guardians.remove(organizationId, id, guardianId, user);
  }

  // --- Placements --------------------------------------------------------------------------------

  @Post('students/:id/enrolments')
  @RequirePermission('students.student.update')
  enrol(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EnrolmentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.enrolments.enrol(organizationId, id, body, user);
  }

  @Patch('students/:id/enrolments/:enrolmentId')
  @RequirePermission('students.student.update')
  updateEnrolment(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
    @Body() body: UpdateEnrolmentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.enrolments.update(organizationId, id, enrolmentId, body, user);
  }

  // --- Promotion ---------------------------------------------------------------------------------

  @Get('promotions/preview')
  @RequirePermission('students.enrolment.promote')
  previewPromotion(
    @OrganizationId() organizationId: string,
    @Query() query: PromotionQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.promotions.preview(organizationId, query, user);
  }

  @Post('promotions')
  @RequirePermission('students.enrolment.promote')
  @HttpCode(200)
  applyPromotion(
    @OrganizationId() organizationId: string,
    @Body() body: ApplyPromotionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.promotions.apply(organizationId, body, user);
  }

  @Get('promotions')
  @RequirePermission('students.enrolment.promote')
  listPromotions(
    @OrganizationId() organizationId: string,
    @Query() query: BranchQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.promotions.listRuns(organizationId, query.branchId, user);
  }

  @Post('promotions/:id/undo')
  @RequirePermission('students.enrolment.promote')
  @HttpCode(200)
  undoPromotion(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.promotions.undo(organizationId, id, user);
  }

  // --- Admission numbers -------------------------------------------------------------------------

  @Put('organization/admission-numbering')
  @RequirePermission('students.settings.update')
  setNumbering(
    @OrganizationId() organizationId: string,
    @Body() body: SetNumberingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.importer.setNumbering(organizationId, body, user);
  }
}

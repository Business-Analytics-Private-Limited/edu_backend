/**
 * THE STUDENTS MODULE (part 1): admission, profile, status, guardians, enrolments.
 * Works only when the super admin has switched the Students module on for the organization.
 * Every action is checked at the student's campus (see the services).
 *
 *   GET    /api/v1/students?search=&campusId=&classId=&batchId=&academicYearId=&status=   students.student.view
 *   POST   /api/v1/students                                    students.student.create  (admission)
 *   GET    /api/v1/students/:id                                students.student.view
 *   PATCH  /api/v1/students/:id                                students.student.update
 *   POST   /api/v1/students/:id/status                         students.student.update
 *   DELETE /api/v1/students/:id                                students.student.delete  (mistakes only)
 *
 *   GET    /api/v1/guardians?phone=                            students.student.view
 *   POST   /api/v1/students/:id/guardians                      students.student.update
 *   PATCH  /api/v1/students/:id/guardians/:guardianId          students.student.update
 *   DELETE /api/v1/students/:id/guardians/:guardianId          students.student.update
 *
 *   POST   /api/v1/students/:id/enrolments                     students.student.update
 *   PATCH  /api/v1/students/:id/enrolments/:enrolmentId        students.student.update, or
 *                                                              students.enrolment.transfer to move
 *
 *   GET    /api/v1/promotions/preview?campusId=&fromYearId=&toYearId=   students.enrolment.promote
 *   POST   /api/v1/promotions                                  students.enrolment.promote
 *   GET    /api/v1/promotions?campusId=                        students.enrolment.promote (applied, newest first)
 *   POST   /api/v1/promotions/:id/undo                         students.enrolment.promote
 *   POST   /api/v1/enrolments/move                             students.enrolment.transfer (shuffle)
 *
 *   POST   /api/v1/students/:id/transfer                       students.enrolment.transfer (both campuses)
 *   POST   /api/v1/students/import                             students.student.import (dryRun to check)
 *   PUT    /api/v1/institutions/:id/admission-numbering        students.settings.update (institution)
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
  ChangeStatusDto,
  EnrolmentDto,
  GuardianDto,
  GuardianSearchQuery,
  ListStudentsQuery,
  ApplyPromotionDto,
  CampusQuery,
  ImportStudentsDto,
  MoveStudentsDto,
  PromotionQuery,
  SetNumberingDto,
  TransferCampusDto,
  UpdateEnrolmentDto,
  UpdateGuardianDto,
  UpdateStudentDto,
} from './dto/student.dto';
import { EnrolmentsService } from './enrolments.service';
import { ImportService } from './import.service';
import { PromotionsService } from './promotions.service';
import { GuardiansService } from './guardians.service';
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

  @Post('students/:id/status')
  @RequirePermission('students.student.update')
  @HttpCode(200)
  changeStatus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChangeStatusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.changeStatus(organizationId, id, body, user);
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

  // --- Enrolments --------------------------------------------------------------------------------

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
  @RequirePermission('students.student.view') // the service checks update / transfer at the campus
  updateEnrolment(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('enrolmentId', ParseUUIDPipe) enrolmentId: string,
    @Body() body: UpdateEnrolmentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.enrolments.update(organizationId, id, enrolmentId, body, user);
  }

  // --- Promotion and shuffle ---------------------------------------------------------------------

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
    @Query() query: CampusQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.promotions.listRuns(organizationId, query.campusId, user);
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

  @Post('enrolments/move')
  @RequirePermission('students.enrolment.transfer')
  @HttpCode(200)
  moveStudents(
    @OrganizationId() organizationId: string,
    @Body() body: MoveStudentsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.promotions.move(organizationId, body, user);
  }

  // --- Campus transfer, import, numbering ---------------------------------------------------------

  @Post('students/:id/transfer')
  @RequirePermission('students.enrolment.transfer')
  @HttpCode(200)
  transferCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransferCampusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.students.transferCampus(organizationId, id, body, user);
  }

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

  @Put('institutions/:id/admission-numbering')
  @RequirePermission('students.settings.update')
  setNumbering(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetNumberingDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.importer.setNumbering(organizationId, id, body.pattern, user);
  }
}

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
  UpdateEnrolmentDto,
  UpdateGuardianDto,
  UpdateStudentDto,
} from './dto/student.dto';
import { EnrolmentsService } from './enrolments.service';
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
}

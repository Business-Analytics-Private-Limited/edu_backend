/**
 * THE ATTENDANCE MODULE (part 1): daily attendance per section, changes and corrections, the
 * daily overview, reports, settings. Works only when the Attendance module is switched on.
 * Every action is checked at the section's / student's campus (see the service).
 *
 *   GET  /api/v1/attendance/roster?classId=&date=             attendance.record.view
 *   POST /api/v1/attendance/markings                          attendance.record.mark (+ .correct for past days)
 *   GET  /api/v1/attendance/daily-summary?campusId=&date=     attendance.record.view
 *   GET  /api/v1/attendance/section-report?classId=&from=&to= attendance.report.view
 *   GET  /api/v1/students/:id/attendance?from=&to=            attendance.record.view
 *   PUT  /api/v1/institutions/:id/attendance-settings         attendance.policy.update
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { AttendanceService } from './attendance.service';
import {
  AttendanceSettingsDto,
  DailySummaryQuery,
  MarkSectionDto,
  RangeQuery,
  RosterQuery,
  SectionReportQuery,
} from './dto/attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('attendance/roster')
  @RequirePermission('attendance.record.view')
  roster(
    @OrganizationId() organizationId: string,
    @Query() query: RosterQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.attendance.roster(organizationId, query.classId, query.date, user);
  }

  @Post('attendance/markings')
  @RequirePermission('attendance.record.mark')
  @HttpCode(200)
  mark(
    @OrganizationId() organizationId: string,
    @Body() body: MarkSectionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.attendance.mark(organizationId, body, user);
  }

  @Get('attendance/daily-summary')
  @RequirePermission('attendance.record.view')
  dailySummary(
    @OrganizationId() organizationId: string,
    @Query() query: DailySummaryQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.attendance.dailySummary(organizationId, query, user);
  }

  @Get('attendance/section-report')
  @RequirePermission('attendance.report.view')
  sectionReport(
    @OrganizationId() organizationId: string,
    @Query() query: SectionReportQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.attendance.sectionReport(organizationId, query, user);
  }

  @Get('students/:id/attendance')
  @RequirePermission('attendance.record.view')
  studentReport(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RangeQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.attendance.studentReport(organizationId, id, query, user);
  }

  @Put('institutions/:id/attendance-settings')
  @RequirePermission('attendance.policy.update')
  updateSettings(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttendanceSettingsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.attendance.updateSettings(organizationId, id, body, user);
  }
}

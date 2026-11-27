/**
 * THE PARENT AND STUDENT PORTAL (ADR-0022).
 *
 * For parents and students (@PortalUser: only portal logins, only with the portal module):
 *   GET    /api/v1/portal/me
 *   GET    /api/v1/portal/students/:id
 *   GET    /api/v1/portal/students/:id/attendance?from=&to=
 *   GET    /api/v1/portal/students/:id/exams                         (locked exams, ADR-0037)
 *   GET    /api/v1/portal/students/:id/exams/:examId
 *   GET    /api/v1/portal/students/:id/exams/:examId/report-card     (PDF)
 *
 * For staff, on a student's page (students.student.update at the student's branch):
 *   POST   /api/v1/students/:id/portal-access            give the student or a guardian a login
 *   DELETE /api/v1/students/:id/portal-access/:userId    remove it
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { PortalUser, RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { GrantPortalAccessDto, PortalRangeQuery } from './dto/portal.dto';
import { PortalAccessService } from './portal-access.service';
import { PortalService } from './portal.service';

@ApiTags('Portal')
@ApiBearerAuth()
@Controller()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly access: PortalAccessService,
  ) {}

  // --- For parents and students ------------------------------------------------------------------

  @Get('portal/me')
  @PortalUser()
  me(@CurrentUser() user: CurrentUserType) {
    return this.portal.me(user);
  }

  @Get('portal/students/:id')
  @PortalUser()
  student(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserType) {
    return this.portal.student(user, id);
  }

  @Get('portal/students/:id/attendance')
  @PortalUser()
  attendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PortalRangeQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.portal.attendance(user, id, query);
  }

  @Get('portal/students/:id/exams')
  @PortalUser()
  exams(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserType) {
    return this.portal.exams(user, id);
  }

  @Get('portal/students/:id/exams/:examId')
  @PortalUser()
  examResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.portal.examResult(user, id, examId);
  }

  @Get('portal/students/:id/exams/:examId/report-card')
  @PortalUser()
  @ApiProduces('application/pdf')
  async reportCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('examId', ParseUUIDPipe) examId: string,
    @CurrentUser() user: CurrentUserType,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { pdf, fileName } = await this.portal.reportCard(user, id, examId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(pdf);
  }

  // --- For staff -----------------------------------------------------------------------------------

  @Post('students/:id/portal-access')
  @RequirePermission('students.student.update')
  grant(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: GrantPortalAccessDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.access.grant(organizationId, id, body, user);
  }

  @Delete('students/:id/portal-access/:userId')
  @RequirePermission('students.student.update')
  revoke(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.access.revoke(organizationId, id, userId, user);
  }
}

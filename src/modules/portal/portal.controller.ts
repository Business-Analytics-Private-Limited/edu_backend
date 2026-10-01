/**
 * THE PARENT AND STUDENT PORTAL (ADR-0022).
 *
 * For parents and students (@PortalUser: only portal logins, only with the portal module):
 *   GET    /api/v1/portal/me
 *   GET    /api/v1/portal/students/:id
 *   GET    /api/v1/portal/students/:id/attendance?from=&to=
 *
 * For staff, on a student's page (students.student.update at the student's campus):
 *   POST   /api/v1/students/:id/portal-access            give the student or a guardian a login
 *   DELETE /api/v1/students/:id/portal-access/:userId    remove it
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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

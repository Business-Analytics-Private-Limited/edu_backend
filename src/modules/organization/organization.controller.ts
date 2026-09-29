/**
 * THE TENANT ADMIN AREA: an organization's own details, dashboard, institutions and campuses.
 * Only users of an organization reach these routes, and only their own organization's data.
 *
 *   GET    /api/v1/dashboard                              any organization user
 *   GET    /api/v1/organization                           platform.institution.view
 *   PATCH  /api/v1/organization                           platform.settings.manage
 *   GET    /api/v1/institutions                           platform.institution.view
 *   POST   /api/v1/institutions                           platform.institution.manage
 *   GET    /api/v1/institutions/:id                       platform.institution.view
 *   PATCH  /api/v1/institutions/:id                       platform.institution.manage
 *   DELETE /api/v1/institutions/:id                       platform.institution.manage
 *   POST   /api/v1/institutions/:id/campuses              platform.campus.manage
 *   PATCH  /api/v1/campuses/:id                           platform.campus.manage
 *   DELETE /api/v1/campuses/:id                           platform.campus.manage
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { OrganizationUser, RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import {
  CreateCampusDto,
  CreateInstitutionDto,
  UpdateCampusDto,
  UpdateInstitutionDto,
  UpdateOwnOrganizationDto,
} from './dto/institution.dto';
import { OrganizationService } from './organization.service';

@ApiTags('Organization')
@ApiBearerAuth()
@Controller()
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}

  @Get('dashboard')
  @OrganizationUser()
  dashboard(@OrganizationId() organizationId: string) {
    return this.organization.dashboard(organizationId);
  }

  @Get('organization')
  @RequirePermission('platform.institution.view')
  getOwn(@OrganizationId() organizationId: string) {
    return this.organization.getOwn(organizationId);
  }

  @Patch('organization')
  @RequirePermission('platform.settings.manage')
  updateOwn(
    @OrganizationId() organizationId: string,
    @Body() body: UpdateOwnOrganizationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateOwn(organizationId, body, user);
  }

  @Get('institutions')
  @RequirePermission('platform.institution.view')
  listInstitutions(@OrganizationId() organizationId: string) {
    return this.organization.listInstitutions(organizationId);
  }

  @Post('institutions')
  @RequirePermission('platform.institution.manage')
  createInstitution(
    @OrganizationId() organizationId: string,
    @Body() body: CreateInstitutionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.createInstitution(organizationId, body, user);
  }

  @Get('institutions/:id')
  @RequirePermission('platform.institution.view')
  getInstitution(@OrganizationId() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.organization.getInstitution(organizationId, id);
  }

  @Patch('institutions/:id')
  @RequirePermission('platform.institution.manage')
  updateInstitution(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInstitutionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateInstitution(organizationId, id, body, user);
  }

  @Delete('institutions/:id')
  @RequirePermission('platform.institution.manage')
  deleteInstitution(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.deleteInstitution(organizationId, id, user);
  }

  @Post('institutions/:id/campuses')
  @RequirePermission('platform.campus.manage')
  createCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) institutionId: string,
    @Body() body: CreateCampusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.createCampus(organizationId, institutionId, body, user);
  }

  @Patch('campuses/:id')
  @RequirePermission('platform.campus.manage')
  updateCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCampusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateCampus(organizationId, id, body, user);
  }

  @Delete('campuses/:id')
  @RequirePermission('platform.campus.manage')
  deleteCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.deleteCampus(organizationId, id, user);
  }
}

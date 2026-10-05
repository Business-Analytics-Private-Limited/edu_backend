/**
 * THE TENANT ADMIN AREA: an organization's own details, dashboard, institutions and campuses.
 * Only users of an organization reach these routes, and only their own organization's data.
 *
 *   GET    /api/v1/dashboard                              any organization user
 *   GET    /api/v1/organization                           platform.organization.view
 *   PATCH  /api/v1/organization                           platform.organization.update
 *   GET    /api/v1/institutions                           platform.institution.view
 *   GET    /api/v1/institutions/:id                       platform.institution.view
 *   PATCH  /api/v1/institutions/:id                       platform.institution.update
 *   POST   /api/v1/institutions/:id/campuses              platform.campus.create
 *   PATCH  /api/v1/campuses/:id                           platform.campus.update
 *   POST   /api/v1/campuses/:id/deactivate                platform.campus.delete (closes it, ADR-0026)
 *   POST   /api/v1/campuses/:id/activate                  Organization admin only
 *   DELETE /api/v1/campuses/:id                           Organization admin only; empty campus only
 *
 * Institutions are added and deleted by the super admin only (ADR-0025, super-admin module).
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { OrganizationUser, RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import {
  CreateCampusDto,
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
  dashboard(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.organization.dashboard(organizationId, user);
  }

  @Get('organization')
  @RequirePermission('platform.organization.view')
  getOwn(@OrganizationId() organizationId: string) {
    return this.organization.getOwn(organizationId);
  }

  @Patch('organization')
  @RequirePermission('platform.organization.update')
  updateOwn(
    @OrganizationId() organizationId: string,
    @Body() body: UpdateOwnOrganizationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateOwn(organizationId, body, user);
  }

  @Get('institutions')
  @RequirePermission('platform.institution.view')
  listInstitutions(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.organization.listInstitutions(organizationId, user);
  }

  @Get('institutions/:id')
  @RequirePermission('platform.institution.view')
  getInstitution(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.getInstitution(organizationId, id, user);
  }

  @Patch('institutions/:id')
  @RequirePermission('platform.institution.update')
  updateInstitution(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateInstitutionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateInstitution(organizationId, id, body, user);
  }

  @Post('institutions/:id/campuses')
  @RequirePermission('platform.campus.create')
  createCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) institutionId: string,
    @Body() body: CreateCampusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.createCampus(organizationId, institutionId, body, user);
  }

  @Patch('campuses/:id')
  @RequirePermission('platform.campus.update')
  updateCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCampusDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateCampus(organizationId, id, body, user);
  }

  @Post('campuses/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('platform.campus.delete')
  deactivateCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.deactivateCampus(organizationId, id, user);
  }

  /** The service checks that the user is the Organization admin. */
  @Post('campuses/:id/activate')
  @HttpCode(200)
  @RequirePermission('platform.campus.update')
  activateCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.activateCampus(organizationId, id, user);
  }

  /** The service checks that the user is the Organization admin and the campus is empty. */
  @Delete('campuses/:id')
  @RequirePermission('platform.campus.delete')
  deleteCampus(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.deleteCampus(organizationId, id, user);
  }
}

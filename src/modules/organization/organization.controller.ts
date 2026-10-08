/**
 * THE ORGANIZATION'S OWN AREA: its details and settings, dashboard and branches.
 * Only users of an organization reach these routes, and only their own organization's data.
 *
 *   GET    /api/v1/dashboard                       any organization user
 *   GET    /api/v1/organization                    platform.organization.view
 *   PATCH  /api/v1/organization                    platform.organization.update
 *   GET    /api/v1/branches                        platform.branch.view
 *   GET    /api/v1/branches/:id                    platform.branch.view
 *   PATCH  /api/v1/branches/:id                    platform.branch.update  (rename)
 *
 * Branches are added, closed and deleted by the super admin only (ADR-0030, super-admin module).
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { OrganizationUser, RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { UpdateBranchDto, UpdateOwnOrganizationDto } from './dto/organization.dto';
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

  @Get('branches')
  @RequirePermission('platform.branch.view')
  listBranches(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.organization.listBranches(organizationId, user);
  }

  @Get('branches/:id')
  @RequirePermission('platform.branch.view')
  getBranch(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.getBranch(organizationId, id, user);
  }

  @Patch('branches/:id')
  @RequirePermission('platform.branch.update')
  updateBranch(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBranchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organization.updateBranch(organizationId, id, body, user);
  }
}

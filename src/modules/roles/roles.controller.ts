/**
 * Roles and the permission list.
 *
 *   GET    /api/v1/permissions          access.role.manage   every permission, grouped
 *   GET    /api/v1/roles                access.user.view
 *   POST   /api/v1/roles                access.role.manage
 *   GET    /api/v1/roles/:id            access.user.view
 *   PATCH  /api/v1/roles/:id            access.role.manage
 *   DELETE /api/v1/roles/:id            access.role.manage
 */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('Organization: roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('access.role.manage')
  permissions(@CurrentUser() user: CurrentUserType) {
    return this.roles.permissionCatalog(user.enabledModules);
  }

  @Get('roles')
  @RequirePermission('access.user.view')
  list(@OrganizationId() organizationId: string) {
    return this.roles.list(organizationId);
  }

  @Post('roles')
  @RequirePermission('access.role.manage')
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateRoleDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.create(organizationId, body, user);
  }

  @Get('roles/:id')
  @RequirePermission('access.user.view')
  get(@OrganizationId() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(organizationId, id);
  }

  @Patch('roles/:id')
  @RequirePermission('access.role.manage')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoleDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.update(organizationId, id, body, user);
  }

  @Delete('roles/:id')
  @RequirePermission('access.role.manage')
  delete(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.delete(organizationId, id, user);
  }
}

/**
 * An organization's roles and the permission list.
 * Predefined roles are listed too, but only the organization's own roles can be changed.
 *
 *   GET    /api/v1/permissions          access.role.view     every resource and its actions
 *   GET    /api/v1/roles                access.role.view
 *   POST   /api/v1/roles                access.role.create
 *   GET    /api/v1/roles/:id            access.role.view
 *   PATCH  /api/v1/roles/:id            access.role.update   own roles; predefined: permissions only
 *   POST   /api/v1/roles/:id/reset      access.role.update   predefined: back to EduPlatform's version
 *   DELETE /api/v1/roles/:id            access.role.delete   own roles only
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
  @RequirePermission('access.role.view')
  permissions(@CurrentUser() user: CurrentUserType) {
    return this.roles.permissionCatalog(user.enabledModules);
  }

  @Get('roles')
  @RequirePermission('access.role.view')
  list(@OrganizationId() organizationId: string) {
    return this.roles.list(organizationId);
  }

  @Post('roles')
  @RequirePermission('access.role.create')
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateRoleDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.create(organizationId, body, user);
  }

  @Get('roles/:id')
  @RequirePermission('access.role.view')
  get(@OrganizationId() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(organizationId, id);
  }

  @Patch('roles/:id')
  @RequirePermission('access.role.update')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoleDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.update(organizationId, id, body, user);
  }

  @Delete('roles/:id')
  @RequirePermission('access.role.delete')
  delete(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.delete(organizationId, id, user);
  }

  /** A customized predefined role goes back to EduPlatform's version (ADR-0029). */
  @Post('roles/:id/reset')
  @HttpCode(200)
  @RequirePermission('access.role.update')
  reset(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.roles.resetToDefault(organizationId, id, user);
  }
}

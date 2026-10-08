/**
 * THE PREDEFINED ROLES, for the super admin: see them, change their permissions, create new ones
 * (ADR-0030). A change applies to that role in every organization that hasn't customized it.
 *
 *   GET /api/v1/super-admin/permissions                 every resource and its actions
 *   GET /api/v1/super-admin/predefined-roles
 *   PUT /api/v1/super-admin/predefined-roles/:key       { permissions: [...] }
 *   POST /api/v1/super-admin/predefined-roles/:key/reset back to EduPlatform's starting permissions
 *   POST /api/v1/super-admin/predefined-roles           { name, description, permissions }
 *   DELETE /api/v1/super-admin/predefined-roles/:key    one the super admin created; nobody has it
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { SuperAdminOnly } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreatePredefinedRoleDto, UpdatePredefinedRoleDto } from './dto/role.dto';
import { RESOURCES } from './permissions';
import { PredefinedRolesService } from './predefined-roles.service';

@ApiTags('Super admin: predefined roles')
@ApiBearerAuth()
@SuperAdminOnly()
@Controller('super-admin')
export class PredefinedRolesController {
  constructor(private readonly predefinedRoles: PredefinedRolesService) {}

  @Get('permissions')
  permissions() {
    return RESOURCES;
  }

  @Get('predefined-roles')
  list() {
    return this.predefinedRoles.listTemplates();
  }

  @Put('predefined-roles/:key')
  update(
    @Param('key') key: string,
    @Body() body: UpdatePredefinedRoleDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.predefinedRoles.updateTemplate(key, body.permissions, user);
  }

  @Post('predefined-roles/:key/reset')
  @HttpCode(200)
  reset(@Param('key') key: string, @CurrentUser() user: CurrentUserType) {
    return this.predefinedRoles.resetTemplate(key, user);
  }

  @Post('predefined-roles')
  create(@Body() body: CreatePredefinedRoleDto, @CurrentUser() user: CurrentUserType) {
    return this.predefinedRoles.createTemplate(body, user);
  }

  @Delete('predefined-roles/:key')
  delete(@Param('key') key: string, @CurrentUser() user: CurrentUserType) {
    return this.predefinedRoles.deleteTemplate(key, user);
  }
}

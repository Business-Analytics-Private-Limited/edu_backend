/**
 * THE PREDEFINED ROLES, for the super admin: see them and change their permissions.
 * A change applies to that role in every organization at once.
 *
 *   GET /api/v1/super-admin/permissions                 every resource and its actions
 *   GET /api/v1/super-admin/predefined-roles
 *   PUT /api/v1/super-admin/predefined-roles/:key       { permissions: [...] }
 */
import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { SuperAdminOnly } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdatePredefinedRoleDto } from './dto/role.dto';
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
}

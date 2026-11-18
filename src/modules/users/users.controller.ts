/**
 * The organization's staff users. Each user has roles, each at a place (whole organization,
 * or one branch); see users.service.ts for the rules.
 *
 *   GET    /api/v1/users?search=&status=&page=&pageSize=    access.user.view
 *   POST   /api/v1/users                                    access.user.create
 *   GET    /api/v1/users/:id                                access.user.view
 *   PATCH  /api/v1/users/:id                                access.user.update   (name)
 *   POST   /api/v1/users/:id/deactivate                     access.user.update
 *   POST   /api/v1/users/:id/activate                       access.user.update
 *   POST   /api/v1/users/:id/roles                          access.user.update   (give a role)
 *   DELETE /api/v1/users/:id/roles/:assignmentId            access.user.update   (take it away)
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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { CreateUserDto, ListUsersQuery, RoleAssignmentDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('Organization: users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('access.user.view')
  list(
    @OrganizationId() organizationId: string,
    @Query() query: ListUsersQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.list(organizationId, query, user);
  }

  @Post()
  @RequirePermission('access.user.create')
  create(
    @OrganizationId() organizationId: string,
    @Body() body: CreateUserDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.create(organizationId, body, user);
  }

  @Get(':id')
  @RequirePermission('access.user.view')
  get(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.get(organizationId, id, user);
  }

  @Patch(':id')
  @RequirePermission('access.user.update')
  update(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.update(organizationId, id, body, user);
  }

  @Post(':id/deactivate')
  @RequirePermission('access.user.update')
  @HttpCode(200)
  deactivate(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.setStatus(organizationId, id, 'INACTIVE', user);
  }

  @Post(':id/activate')
  @RequirePermission('access.user.update')
  @HttpCode(200)
  activate(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.setStatus(organizationId, id, 'ACTIVE', user);
  }

  @Post(':id/roles')
  @RequirePermission('access.user.update')
  addRole(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RoleAssignmentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.addRole(organizationId, id, body, user);
  }

  @Delete(':id/roles/:assignmentId')
  @RequirePermission('access.user.update')
  removeRole(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.users.removeRole(organizationId, id, assignmentId, user);
  }
}

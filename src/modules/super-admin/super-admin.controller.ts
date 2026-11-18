/**
 * THE SUPER ADMIN AREA. Every route here is for EduPlatform staff only (@SuperAdminOnly).
 *
 *   GET   /api/v1/super-admin/dashboard
 *   GET   /api/v1/super-admin/modules
 *   GET   /api/v1/super-admin/organizations?search=&status=&page=&pageSize=
 *   POST  /api/v1/super-admin/organizations
 *   GET   /api/v1/super-admin/organizations/:id
 *   PATCH /api/v1/super-admin/organizations/:id
 *   POST  /api/v1/super-admin/organizations/:id/suspend
 *   POST  /api/v1/super-admin/organizations/:id/activate
 *   PUT   /api/v1/super-admin/organizations/:id/modules/:moduleKey
 *   POST   /api/v1/super-admin/organizations/:id/branches
 *   POST   /api/v1/super-admin/organizations/:id/branches/:branchId/deactivate
 *   POST   /api/v1/super-admin/organizations/:id/branches/:branchId/activate
 *   DELETE /api/v1/super-admin/organizations/:id/branches/:branchId   (empty only)
 *
 * Only the super admin adds, closes and deletes branches (ADR-0030).
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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { SuperAdminOnly } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateBranchDto } from '../organization/dto/organization.dto';
import {
  CreateOrganizationDto,
  ListOrganizationsQuery,
  SetModuleDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Super admin')
@ApiBearerAuth()
@SuperAdminOnly()
@Controller('super-admin')
export class SuperAdminController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('dashboard')
  dashboard() {
    return this.organizations.dashboard();
  }

  @Get('modules')
  modules() {
    return this.organizations.modules();
  }

  @Get('organizations')
  list(@Query() query: ListOrganizationsQuery) {
    return this.organizations.list(query);
  }

  @Post('organizations')
  create(@Body() body: CreateOrganizationDto, @CurrentUser() user: CurrentUserType) {
    return this.organizations.create(body, user);
  }

  @Get('organizations/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.get(id);
  }

  @Patch('organizations/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateOrganizationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.update(id, body, user);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  suspend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserType) {
    return this.organizations.setStatus(id, 'SUSPENDED', user);
  }

  @Post('organizations/:id/activate')
  @HttpCode(200)
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserType) {
    return this.organizations.setStatus(id, 'ACTIVE', user);
  }

  @Put('organizations/:id/modules/:moduleKey')
  setModule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('moduleKey') moduleKey: string,
    @Body() body: SetModuleDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.setModule(id, moduleKey, body.enabled, user);
  }

  @Post('organizations/:id/branches')
  addBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateBranchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.addBranch(id, body, user);
  }

  /** Closes a branch (ADR-0026); refused while current students study there. */
  @Post('organizations/:id/branches/:branchId/deactivate')
  @HttpCode(200)
  deactivateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.deactivateBranch(id, branchId, user);
  }

  @Post('organizations/:id/branches/:branchId/activate')
  @HttpCode(200)
  activateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.activateBranch(id, branchId, user);
  }

  @Delete('organizations/:id/branches/:branchId')
  deleteBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.deleteBranch(id, branchId, user);
  }
}

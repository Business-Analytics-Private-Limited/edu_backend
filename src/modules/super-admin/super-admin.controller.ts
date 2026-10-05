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
 *   POST   /api/v1/super-admin/organizations/:id/institutions
 *   DELETE /api/v1/super-admin/organizations/:id/institutions/:institutionId   (empty only)
 *   POST   /api/v1/super-admin/organizations/:id/institutions/:institutionId/deactivate
 *   POST   /api/v1/super-admin/organizations/:id/institutions/:institutionId/activate
 *
 * Only the super admin adds and deletes institutions (ADR-0025).
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
import { CreateInstitutionDto } from '../organization/dto/institution.dto';
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

  @Post('organizations/:id/institutions')
  addInstitution(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateInstitutionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.addInstitution(id, body, user);
  }

  /** Closes an institution (ADR-0026); refused while it has active students. */
  @Post('organizations/:id/institutions/:institutionId/deactivate')
  @HttpCode(200)
  deactivateInstitution(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('institutionId', ParseUUIDPipe) institutionId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.deactivateInstitution(id, institutionId, user);
  }

  @Post('organizations/:id/institutions/:institutionId/activate')
  @HttpCode(200)
  activateInstitution(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('institutionId', ParseUUIDPipe) institutionId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.activateInstitution(id, institutionId, user);
  }

  @Delete('organizations/:id/institutions/:institutionId')
  deleteInstitution(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('institutionId', ParseUUIDPipe) institutionId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.organizations.deleteInstitution(id, institutionId, user);
  }
}

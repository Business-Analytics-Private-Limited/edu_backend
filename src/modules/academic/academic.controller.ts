/**
 * THE ACADEMIC MODULE: academic years, class levels and classes, batches.
 * Works only when the super admin has switched the Academic module on for the organization
 * (the AccessGuard checks it for every academic.* permission). Where each action applies is
 * checked in the services (institution or campus).
 *
 *   GET    /api/v1/academic-years?institutionId=        academic.year.view
 *   POST   /api/v1/academic-years                       academic.year.create   (institution)
 *   PATCH  /api/v1/academic-years/:id                   academic.year.update   (institution)
 *   POST   /api/v1/academic-years/:id/activate          academic.year.update   (institution)
 *   DELETE /api/v1/academic-years/:id                   academic.year.delete   (institution)
 *
 *   GET    /api/v1/institutions/:id/class-levels        academic.structure.view
 *   PUT    /api/v1/institutions/:id/class-levels        academic.structure.update (institution)
 *   GET    /api/v1/campuses/:id/classes                 academic.structure.view   (campus)
 *   POST   /api/v1/campuses/:id/classes                 academic.structure.create (campus)
 *   PATCH  /api/v1/classes/:id                          academic.structure.update (campus)
 *   DELETE /api/v1/classes/:id                          academic.structure.delete (campus)
 *
 *   GET    /api/v1/batches?institutionId=               academic.batch.view
 *   POST   /api/v1/batches                              academic.batch.create  (institution)
 *   PATCH  /api/v1/batches/:id                          academic.batch.update  (institution)
 *   DELETE /api/v1/batches/:id                          academic.batch.delete  (institution)
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
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { AcademicYearsService } from './academic-years.service';
import { BatchesService } from './batches.service';
import { ClassStructureService } from './class-structure.service';
import {
  CreateAcademicYearDto,
  CreateBatchDto,
  CreateClassDto,
  InstitutionFilterQuery,
  SetClassLevelsDto,
  UpdateAcademicYearDto,
  UpdateBatchDto,
  UpdateClassDto,
} from './dto/academic.dto';

@ApiTags('Academic')
@ApiBearerAuth()
@Controller()
export class AcademicController {
  constructor(
    private readonly years: AcademicYearsService,
    private readonly structure: ClassStructureService,
    private readonly batches: BatchesService,
  ) {}

  // --- Academic years --------------------------------------------------------------------------

  @Get('academic-years')
  @RequirePermission('academic.year.view')
  listYears(
    @OrganizationId() organizationId: string,
    @Query() query: InstitutionFilterQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.years.list(organizationId, user, query.institutionId);
  }

  @Post('academic-years')
  @RequirePermission('academic.year.create')
  createYear(
    @OrganizationId() organizationId: string,
    @Body() body: CreateAcademicYearDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.years.create(organizationId, body, user);
  }

  @Patch('academic-years/:id')
  @RequirePermission('academic.year.update')
  updateYear(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAcademicYearDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.years.update(organizationId, id, body, user);
  }

  @Post('academic-years/:id/activate')
  @RequirePermission('academic.year.update')
  @HttpCode(200)
  activateYear(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.years.activate(organizationId, id, user);
  }

  @Delete('academic-years/:id')
  @RequirePermission('academic.year.delete')
  deleteYear(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.years.delete(organizationId, id, user);
  }

  // --- Class levels and classes ------------------------------------------------------------------

  @Get('institutions/:id/class-levels')
  @RequirePermission('academic.structure.view')
  getLevels(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.getLevels(organizationId, id, user);
  }

  @Put('institutions/:id/class-levels')
  @RequirePermission('academic.structure.update')
  setLevels(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetClassLevelsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.setLevels(organizationId, id, body, user);
  }

  @Get('campuses/:id/classes')
  @RequirePermission('academic.structure.view')
  listClasses(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.listClasses(organizationId, id, user);
  }

  @Post('campuses/:id/classes')
  @RequirePermission('academic.structure.create')
  createClass(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateClassDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.createClass(organizationId, id, body, user);
  }

  @Patch('classes/:id')
  @RequirePermission('academic.structure.update')
  updateClass(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateClassDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.updateClass(organizationId, id, body, user);
  }

  @Delete('classes/:id')
  @RequirePermission('academic.structure.delete')
  deleteClass(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.deleteClass(organizationId, id, user);
  }

  // --- Batches -----------------------------------------------------------------------------------

  @Get('batches')
  @RequirePermission('academic.batch.view')
  listBatches(
    @OrganizationId() organizationId: string,
    @Query() query: InstitutionFilterQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.batches.list(organizationId, user, query.institutionId);
  }

  @Post('batches')
  @RequirePermission('academic.batch.create')
  createBatch(
    @OrganizationId() organizationId: string,
    @Body() body: CreateBatchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.batches.create(organizationId, body, user);
  }

  @Patch('batches/:id')
  @RequirePermission('academic.batch.update')
  updateBatch(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBatchDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.batches.update(organizationId, id, body, user);
  }

  @Delete('batches/:id')
  @RequirePermission('academic.batch.delete')
  deleteBatch(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.batches.delete(organizationId, id, user);
  }
}

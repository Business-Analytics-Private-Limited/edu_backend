/**
 * THE ACADEMIC MODULE: academic years and the academic structure (ADR-0030).
 * Works only when the super admin has switched the Academic module on for the organization
 * (the AccessGuard checks it for every academic.* permission). Where each action applies is
 * checked in the services: the whole organization, or the branch of a section.
 *
 *   GET    /api/v1/academic-years                          academic.year.view
 *   POST   /api/v1/academic-years                          academic.year.create   (organization)
 *   PATCH  /api/v1/academic-years/:id                      academic.year.update   (organization)
 *   POST   /api/v1/academic-years/:id/activate             academic.year.update   (organization)
 *   DELETE /api/v1/academic-years/:id                      academic.year.delete   (organization)
 *
 *   GET    /api/v1/academic-structure                      academic.structure.view
 *   PUT    /api/v1/academic-structure/level-names          academic.structure.update (organization)
 *   PUT    /api/v1/academic-structure/school-classes       academic.structure.update  School
 *   PUT    /api/v1/academic-structure/groups               academic.structure.update  Intermediate
 *   POST   /api/v1/academic-structure/streams              academic.structure.create  Intermediate
 *   PATCH  /api/v1/academic-structure/streams/:group/:code academic.structure.update  Intermediate
 *   DELETE /api/v1/academic-structure/streams/:group/:code academic.structure.delete  Intermediate
 *   POST   /api/v1/academic-structure/courses              academic.structure.create  Degree / Eng.
 *   POST   /api/v1/academic-structure/courses/:id/specializations                     Degree / Eng.
 *   PATCH  /api/v1/classes/:id                             academic.structure.update  (its place)
 *   DELETE /api/v1/classes/:id                             academic.structure.delete  (its place)
 *
 *   GET    /api/v1/branches/:id/sections                   academic.structure.view    (branch)
 *   POST   /api/v1/branches/:id/sections                   academic.structure.create  (branch)
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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { AcademicYearsService } from './academic-years.service';
import {
  AddCourseDto,
  AddSpecializationDto,
  AddStreamDto,
  CreateAcademicYearDto,
  CreateSectionDto,
  RenameDto,
  SetCodesDto,
  SetLevelNamesDto,
  UpdateAcademicYearDto,
  UpdateClassDto,
} from './dto/academic.dto';
import { StructureService } from './structure.service';

@ApiTags('Academic')
@ApiBearerAuth()
@Controller()
export class AcademicController {
  constructor(
    private readonly years: AcademicYearsService,
    private readonly structure: StructureService,
  ) {}

  // --- Academic years --------------------------------------------------------------------------

  @Get('academic-years')
  @RequirePermission('academic.year.view')
  listYears(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.years.list(organizationId, user);
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

  // --- The structure ---------------------------------------------------------------------------

  @Get('academic-structure')
  @RequirePermission('academic.structure.view')
  getStructure(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.structure.get(organizationId, user);
  }

  @Put('academic-structure/level-names')
  @RequirePermission('academic.structure.update')
  setLevelNames(
    @OrganizationId() organizationId: string,
    @Body() body: SetLevelNamesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.setLevelNames(organizationId, body.names, user);
  }

  @Put('academic-structure/school-classes')
  @RequirePermission('academic.structure.update')
  setSchoolClasses(
    @OrganizationId() organizationId: string,
    @Body() body: SetCodesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.setSchoolClasses(organizationId, body.codes, user);
  }

  @Put('academic-structure/groups')
  @RequirePermission('academic.structure.update')
  setGroups(
    @OrganizationId() organizationId: string,
    @Body() body: SetCodesDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.setGroups(organizationId, body.codes, user);
  }

  @Post('academic-structure/streams')
  @RequirePermission('academic.structure.create')
  addStream(
    @OrganizationId() organizationId: string,
    @Body() body: AddStreamDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.addStream(organizationId, body, user);
  }

  @Patch('academic-structure/streams/:group/:code')
  @RequirePermission('academic.structure.update')
  renameStream(
    @OrganizationId() organizationId: string,
    @Param('group') group: string,
    @Param('code') code: string,
    @Body() body: RenameDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.renameStream(organizationId, group, code, body.name, user);
  }

  @Delete('academic-structure/streams/:group/:code')
  @RequirePermission('academic.structure.delete')
  deleteStream(
    @OrganizationId() organizationId: string,
    @Param('group') group: string,
    @Param('code') code: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.deleteStream(organizationId, group, code, user);
  }

  @Post('academic-structure/courses')
  @RequirePermission('academic.structure.create')
  addCourse(
    @OrganizationId() organizationId: string,
    @Body() body: AddCourseDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.addCourse(organizationId, body, user);
  }

  @Post('academic-structure/courses/:id/specializations')
  @RequirePermission('academic.structure.create')
  addSpecialization(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddSpecializationDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.addSpecialization(organizationId, id, body, user);
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

  // --- Sections of a branch --------------------------------------------------------------------

  @Get('branches/:id/sections')
  @RequirePermission('academic.structure.view')
  listSections(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.listSections(organizationId, id, user);
  }

  @Post('branches/:id/sections')
  @RequirePermission('academic.structure.create')
  createSection(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateSectionDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.structure.createSection(organizationId, id, body, user);
  }
}

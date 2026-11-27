/**
 * THE ACADEMIC MODULE, part 2: subjects and the calendar. Works only when the Academic module is
 * switched on. Where each action applies is checked in the services (organization or branch).
 *
 *   GET    /api/v1/subjects                             academic.subject.view
 *   POST   /api/v1/subjects                             academic.subject.create   (organization)
 *   PATCH  /api/v1/subjects/:id                         academic.subject.update   (organization)
 *   DELETE /api/v1/subjects/:id                         academic.subject.delete   (organization)
 *   GET    /api/v1/subjects/:id/chapters                academic.subject.view     (syllabus, ADR-0037)
 *   POST   /api/v1/subjects/:id/chapters                academic.subject.update   (organization)
 *   PUT    /api/v1/subjects/:id/chapters/order          academic.subject.update
 *   PATCH  /api/v1/chapters/:id                         academic.subject.update
 *   DELETE /api/v1/chapters/:id                         academic.subject.update   (only if no exam ticked it)
 *   GET    /api/v1/classes/:id/subjects                 academic.structure.view
 *   PUT    /api/v1/classes/:id/subjects                 academic.structure.update (class's place)
 *
 *   GET    /api/v1/calendar?from=&to=                   academic.calendar.view
 *   PUT    /api/v1/calendar/weekly-off                  academic.calendar.update  (organization)
 *   POST   /api/v1/holidays                             academic.calendar.create  (organization or branch)
 *   DELETE /api/v1/holidays/:id                         academic.calendar.delete  (organization or branch)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CalendarService } from './calendar.service';
import { ChaptersService } from './chapters.service';
import {
  AddChaptersDto,
  CreateHolidayDto,
  ReorderChaptersDto,
  UpdateChapterDto,
  CreateSubjectDto,
  HolidayQuery,
  SetClassSubjectsDto,
  SetWeeklyOffDto,
  UpdateSubjectDto,
} from './dto/academic.dto';
import { SubjectsService } from './subjects.service';

@ApiTags('Academic')
@ApiBearerAuth()
@Controller()
export class SubjectsCalendarController {
  constructor(
    private readonly subjects: SubjectsService,
    private readonly calendar: CalendarService,
    private readonly chapters: ChaptersService,
  ) {}

  // --- Subjects ----------------------------------------------------------------------------------

  @Get('subjects')
  @RequirePermission('academic.subject.view')
  listSubjects(@OrganizationId() organizationId: string, @CurrentUser() user: CurrentUserType) {
    return this.subjects.list(organizationId, user);
  }

  @Post('subjects')
  @RequirePermission('academic.subject.create')
  createSubject(
    @OrganizationId() organizationId: string,
    @Body() body: CreateSubjectDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subjects.create(organizationId, body, user);
  }

  @Patch('subjects/:id')
  @RequirePermission('academic.subject.update')
  updateSubject(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSubjectDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subjects.update(organizationId, id, body, user);
  }

  @Delete('subjects/:id')
  @RequirePermission('academic.subject.delete')
  deleteSubject(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subjects.delete(organizationId, id, user);
  }

  // --- Syllabus: chapters of a subject (ADR-0037) ---------------------------------------------------

  @Get('subjects/:id/chapters')
  @RequirePermission('academic.subject.view')
  listChapters(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.chapters.list(organizationId, id, user);
  }

  @Post('subjects/:id/chapters')
  @RequirePermission('academic.subject.update')
  addChapters(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddChaptersDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.chapters.add(organizationId, id, body, user);
  }

  @Put('subjects/:id/chapters/order')
  @RequirePermission('academic.subject.update')
  reorderChapters(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReorderChaptersDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.chapters.reorder(organizationId, id, body, user);
  }

  @Patch('chapters/:id')
  @RequirePermission('academic.subject.update')
  updateChapter(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateChapterDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.chapters.update(organizationId, id, body, user);
  }

  @Delete('chapters/:id')
  @RequirePermission('academic.subject.update')
  deleteChapter(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.chapters.delete(organizationId, id, user);
  }

  @Get('classes/:id/subjects')
  @RequirePermission('academic.structure.view')
  classSubjects(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subjects.forClass(organizationId, id, user);
  }

  @Put('classes/:id/subjects')
  @RequirePermission('academic.structure.update')
  setClassSubjects(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetClassSubjectsDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.subjects.setForClass(organizationId, id, body, user);
  }

  // --- Calendar ----------------------------------------------------------------------------------

  @Get('calendar')
  @RequirePermission('academic.calendar.view')
  getCalendar(
    @OrganizationId() organizationId: string,
    @Query() query: HolidayQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calendar.list(organizationId, user, query);
  }

  @Put('calendar/weekly-off')
  @RequirePermission('academic.calendar.update')
  setWeeklyOff(
    @OrganizationId() organizationId: string,
    @Body() body: SetWeeklyOffDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calendar.setWeeklyOff(organizationId, body, user);
  }

  @Post('holidays')
  @RequirePermission('academic.calendar.create')
  createHoliday(
    @OrganizationId() organizationId: string,
    @Body() body: CreateHolidayDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calendar.createHoliday(organizationId, body, user);
  }

  @Delete('holidays/:id')
  @RequirePermission('academic.calendar.delete')
  deleteHoliday(
    @OrganizationId() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.calendar.deleteHoliday(organizationId, id, user);
  }
}

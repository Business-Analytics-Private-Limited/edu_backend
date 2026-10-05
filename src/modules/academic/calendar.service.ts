/**
 * The ACADEMIC CALENDAR: which days have no classes.
 *   - weekly off days per institution (e.g. Sunday), 0 = Sunday ... 6 = Saturday;
 *   - holidays: one day or a range, for the whole institution or for one campus only.
 * Attendance will use this to know the working days.
 *
 * Rules:
 *   - weekly off days and institution-wide holidays are managed for the institution;
 *     a campus holiday at that campus (a Campus admin adds their campus's holidays);
 *   - everyone working in the institution sees its calendar (a campus only sees its own
 *     campus holidays and the institution-wide ones).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhereIn } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateHolidayDto, HolidayQuery, SetWeeklyOffDto } from './dto/academic.dto';
import { assertCampusInUse, assertInstitutionInUse } from '../organization/places-in-use';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  setWeeklyOff(
    organizationId: string,
    institutionId: string,
    dto: SetWeeklyOffDto,
    actor: CurrentUser,
  ) {
    const place = { institutionId };
    assertCan(actor, 'academic.calendar.update', place);
    const days = [...new Set(dto.days)].sort();
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findInstitution(db, organizationId, institutionId);
      const institution = await db.institution.update({
        where: { id: institutionId },
        data: { weeklyOffDays: days },
        select: { id: true, name: true, weeklyOffDays: true },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'weekly_off_days',
        entityId: institutionId,
        ...place,
        details: { before: existing.weeklyOffDays, after: days },
      });
      return institution;
    });
  }

  /**
   * The calendar of every institution the user works in: weekly off days, and holidays
   * (optionally only those touching a date range).
   */
  list(organizationId: string, actor: CurrentUser, query: HolidayQuery) {
    const range: Prisma.HolidayWhereInput = {
      ...(query.from && { endsOn: { gte: new Date(query.from) } }),
      ...(query.to && { startsOn: { lte: new Date(query.to) } }),
    };
    return this.prisma.forOrganization(organizationId, async (db) => {
      const [institutions, holidays] = await Promise.all([
        db.institution.findMany({
          where: { organizationId, ...(query.institutionId && { id: query.institutionId }) },
          select: { id: true, name: true, weeklyOffDays: true },
          orderBy: { name: 'asc' },
        }),
        db.holiday.findMany({
          where: {
            organizationId,
            ...(query.institutionId && { institutionId: query.institutionId }),
            ...range,
          },
          include: { campus: { select: { id: true, name: true } } },
          orderBy: { startsOn: 'asc' },
        }),
      ]);
      const view = 'academic.calendar.view';
      return {
        institutions: institutions.filter((i) => canSomewhereIn(actor, view, i.id)),
        holidays: holidays.filter((h) =>
          h.campusId
            ? can(actor, view, { institutionId: h.institutionId, campusId: h.campusId })
            : canSomewhereIn(actor, view, h.institutionId),
        ),
      };
    });
  }

  createHoliday(organizationId: string, dto: CreateHolidayDto, actor: CurrentUser) {
    const endsOn = dto.endsOn ?? dto.startsOn;
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, dto.institutionId);
      if (dto.campusId) {
        const campus = await db.campus.findFirst({
          where: { id: dto.campusId, institutionId: dto.institutionId },
        });
        if (!campus) throw new NotFoundException('Campus not found in this institution');
      }
      const place = { institutionId: dto.institutionId, campusId: dto.campusId ?? null };
      assertCan(actor, 'academic.calendar.create', place);
      if (dto.campusId) await assertCampusInUse(db, dto.campusId);
      else await assertInstitutionInUse(db, dto.institutionId);
      if (new Date(dto.startsOn) > new Date(endsOn)) {
        throw new BadRequestException('A holiday must start on or before its last day');
      }
      const holiday = await db.holiday.create({
        data: {
          organizationId,
          institutionId: dto.institutionId,
          campusId: dto.campusId ?? null,
          name: dto.name,
          startsOn: new Date(dto.startsOn),
          endsOn: new Date(endsOn),
        },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'holiday',
        entityId: holiday.id,
        ...place,
        details: { name: holiday.name, startsOn: dto.startsOn, endsOn },
      });
      return holiday;
    });
  }

  deleteHoliday(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const holiday = await db.holiday.findFirst({ where: { id, organizationId } });
      if (!holiday) throw new NotFoundException('Holiday not found');
      const place = { institutionId: holiday.institutionId, campusId: holiday.campusId };
      assertCan(actor, 'academic.calendar.delete', place);
      await db.holiday.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'holiday',
        entityId: id,
        ...place,
        details: { name: holiday.name },
      });
      return { deleted: true };
    });
  }

  private async findInstitution(db: Db, organizationId: string, id: string) {
    const institution = await db.institution.findFirst({ where: { id, organizationId } });
    if (!institution) throw new NotFoundException('Institution not found');
    return institution;
  }
}

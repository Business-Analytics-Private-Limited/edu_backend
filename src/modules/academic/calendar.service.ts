/**
 * The ACADEMIC CALENDAR: which days have no classes.
 *   - weekly off days for the whole organization (e.g. Sunday), 0 = Sunday ... 6 = Saturday;
 *   - holidays: one day or a range, for the whole organization or for one branch only.
 * Attendance uses this to know the working days.
 *
 * Rules:
 *   - weekly off days and organization-wide holidays need the permission for the whole
 *     organization; a branch holiday, the permission at that branch (a Branch admin adds their
 *     branch's holidays);
 *   - a branch sees the organization's holidays and its own.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhere } from '../../common/scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertBranchInUse, findBranch } from '../organization/places-in-use';
import { CreateHolidayDto, HolidayQuery, SetWeeklyOffDto } from './dto/academic.dto';

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  setWeeklyOff(organizationId: string, dto: SetWeeklyOffDto, actor: CurrentUser) {
    assertCan(actor, 'academic.calendar.update', {});
    const days = [...new Set(dto.days)].sort();
    return this.prisma.forOrganization(organizationId, async (db) => {
      const before = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
      await db.organization.update({
        where: { id: organizationId },
        data: { weeklyOffDays: days },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'weekly_off_days',
        entityId: organizationId,
        details: { before: before.weeklyOffDays, after: days },
      });
      return { weeklyOffDays: days };
    });
  }

  /** Weekly off days, and the holidays the user may see (optionally only in a date range). */
  list(organizationId: string, actor: CurrentUser, query: HolidayQuery) {
    const view = 'academic.calendar.view';
    if (!canSomewhere(actor, view)) {
      return Promise.resolve({ weeklyOffDays: [] as number[], holidays: [] });
    }
    const range: Prisma.HolidayWhereInput = {
      ...(query.from && { endsOn: { gte: new Date(query.from) } }),
      ...(query.to && { startsOn: { lte: new Date(query.to) } }),
    };
    return this.prisma.forOrganization(organizationId, async (db) => {
      const [organization, holidays] = await Promise.all([
        db.organization.findUniqueOrThrow({ where: { id: organizationId } }),
        db.holiday.findMany({
          where: { organizationId, ...range },
          include: { branch: { select: { id: true, name: true } } },
          orderBy: { startsOn: 'asc' },
        }),
      ]);
      return {
        weeklyOffDays: organization.weeklyOffDays,
        holidays: holidays.filter((h) => !h.branchId || can(actor, view, { branchId: h.branchId })),
      };
    });
  }

  createHoliday(organizationId: string, dto: CreateHolidayDto, actor: CurrentUser) {
    const endsOn = dto.endsOn ?? dto.startsOn;
    return this.prisma.forOrganization(organizationId, async (db) => {
      if (dto.branchId) await findBranch(db, organizationId, dto.branchId);
      const place = { branchId: dto.branchId ?? null };
      assertCan(actor, 'academic.calendar.create', place);
      if (dto.branchId) await assertBranchInUse(db, dto.branchId);
      if (new Date(dto.startsOn) > new Date(endsOn)) {
        throw new BadRequestException('A holiday must start on or before its last day');
      }
      const holiday = await db.holiday.create({
        data: {
          organizationId,
          branchId: dto.branchId ?? null,
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
      const place = { branchId: holiday.branchId };
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
}

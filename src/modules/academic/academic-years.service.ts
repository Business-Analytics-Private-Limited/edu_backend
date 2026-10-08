/**
 * The organization's academic years, e.g. "2026-27" from 1 June 2026 to 31 March 2027. One set
 * of years for the whole organization, shared by all branches (ADR-0030).
 *
 * Rules:
 *   - dates don't overlap another year of the organization;
 *   - at most one year is ACTIVE: activating one closes the previous active year;
 *   - managing years needs the permission for the whole organization; anyone with
 *     "academic.year.view" (at any branch) may see them.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcademicYear, Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAcademicYearDto, UpdateAcademicYearDto } from './dto/academic.dto';

const WHOLE_ORGANIZATION = {};

@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The organization's years, newest first. */
  list(organizationId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'academic.year.view')) return Promise.resolve([]);
    return this.prisma.forOrganization(organizationId, (db) =>
      db.academicYear.findMany({ where: { organizationId }, orderBy: { startsOn: 'desc' } }),
    );
  }

  create(organizationId: string, dto: CreateAcademicYearDto, actor: CurrentUser) {
    assertCan(actor, 'academic.year.create', WHOLE_ORGANIZATION);
    const dates = toDates(dto.startsOn, dto.endsOn);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.checkNoOverlap(db, organizationId, dates);
      const year = await db.academicYear.create({
        data: { organizationId, name: dto.name, ...dates },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'academic_year',
        entityId: year.id,
        details: { name: year.name, startsOn: dto.startsOn, endsOn: dto.endsOn },
      });
      return year;
    });
  }

  update(organizationId: string, id: string, dto: UpdateAcademicYearDto, actor: CurrentUser) {
    assertCan(actor, 'academic.year.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findYear(db, organizationId, id);
      if (existing.status === 'CLOSED') {
        throw new BadRequestException('A closed academic year can no longer be changed');
      }
      const dates = toDates(
        dto.startsOn ?? isoDate(existing.startsOn),
        dto.endsOn ?? isoDate(existing.endsOn),
      );
      await this.checkNoOverlap(db, organizationId, dates, id);
      const year = await db.academicYear.update({
        where: { id },
        data: { name: dto.name, ...dates },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'academic_year',
        entityId: id,
        details: { ...dto },
      });
      return year;
    });
  }

  /** Makes this the current year; the previous active year is closed. */
  activate(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'academic.year.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findYear(db, organizationId, id);
      if (existing.status === 'ACTIVE') return existing;
      if (existing.status === 'CLOSED') {
        throw new BadRequestException('A closed academic year cannot be made active again');
      }
      const closed = await db.academicYear.updateMany({
        where: { organizationId, status: 'ACTIVE' },
        data: { status: 'CLOSED' },
      });
      const year = await db.academicYear.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.audit.log(db, actor, {
        action: 'activate',
        entity: 'academic_year',
        entityId: id,
        details: { name: year.name, closedPrevious: closed.count > 0 },
      });
      return year;
    });
  }

  /** Only a PLANNED year can be deleted (an active or closed one has history). */
  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'academic.year.delete', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findYear(db, organizationId, id);
      if (existing.status !== 'PLANNED') {
        throw new BadRequestException('Only a planned academic year can be deleted');
      }
      if ((await db.enrolment.count({ where: { academicYearId: id } })) > 0) {
        throw new BadRequestException('Students are already placed in this academic year');
      }
      await db.academicYear.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'academic_year',
        entityId: id,
        details: { name: existing.name },
      });
      return { deleted: true };
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private async findYear(db: Db, organizationId: string, id: string): Promise<AcademicYear> {
    const year = await db.academicYear.findFirst({ where: { id, organizationId } });
    if (!year) throw new NotFoundException('Academic year not found');
    return year;
  }

  /** Two years of the organization may not share any day. */
  private async checkNoOverlap(
    db: Db,
    organizationId: string,
    dates: { startsOn: Date; endsOn: Date },
    exceptId?: string,
  ) {
    const where: Prisma.AcademicYearWhereInput = {
      organizationId,
      startsOn: { lte: dates.endsOn },
      endsOn: { gte: dates.startsOn },
      ...(exceptId && { id: { not: exceptId } }),
    };
    const clash = await db.academicYear.findFirst({ where });
    if (clash) {
      throw new BadRequestException(`These dates overlap the academic year ${clash.name}`);
    }
  }
}

/** "2026-06-01" -> Date, and checks that the year starts before it ends. */
function toDates(startsOn: string, endsOn: string) {
  const dates = { startsOn: new Date(startsOn), endsOn: new Date(endsOn) };
  if (dates.startsOn >= dates.endsOn) {
    throw new BadRequestException('An academic year must start before it ends');
  }
  return dates;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

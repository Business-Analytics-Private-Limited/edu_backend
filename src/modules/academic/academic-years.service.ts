/**
 * Academic years of each institution, e.g. "2026-27" from 1 June 2026 to 31 March 2027.
 *
 * Rules:
 *   - a year belongs to one institution; its dates don't overlap another year of that institution;
 *   - at most one year is ACTIVE per institution: activating one closes the previous active year;
 *   - managing years needs the permission for the institution (a Principal, or organization-wide
 *     admins); people working in one campus of it may view them.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AcademicYear, Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhereIn } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAcademicYearDto, UpdateAcademicYearDto } from './dto/academic.dto';

@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The years of every institution the user may see (newest first). */
  list(organizationId: string, actor: CurrentUser, institutionId?: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const years = await db.academicYear.findMany({
        where: { organizationId, ...(institutionId && { institutionId }) },
        orderBy: { startsOn: 'desc' },
        include: { institution: { select: { id: true, name: true } } },
      });
      return years.filter((y) => canSomewhereIn(actor, 'academic.year.view', y.institutionId));
    });
  }

  create(organizationId: string, dto: CreateAcademicYearDto, actor: CurrentUser) {
    const place = { institutionId: dto.institutionId };
    assertCan(actor, 'academic.year.create', place);
    const dates = toDates(dto.startsOn, dto.endsOn);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, dto.institutionId);
      await this.checkNoOverlap(db, dto.institutionId, dates);
      const year = await db.academicYear.create({
        data: { organizationId, institutionId: dto.institutionId, name: dto.name, ...dates },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'academic_year',
        entityId: year.id,
        ...place,
        details: { name: year.name, startsOn: dto.startsOn, endsOn: dto.endsOn },
      });
      return year;
    });
  }

  update(organizationId: string, id: string, dto: UpdateAcademicYearDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findYear(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.year.update', place);
      if (existing.status === 'CLOSED') {
        throw new BadRequestException('A closed academic year can no longer be changed');
      }
      const dates = toDates(
        dto.startsOn ?? isoDate(existing.startsOn),
        dto.endsOn ?? isoDate(existing.endsOn),
      );
      await this.checkNoOverlap(db, existing.institutionId, dates, id);
      const year = await db.academicYear.update({
        where: { id },
        data: { name: dto.name, ...dates },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'academic_year',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return year;
    });
  }

  /** Makes this the institution's current year; the previous active year is closed. */
  activate(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findYear(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.year.update', place);
      if (existing.status === 'ACTIVE') return existing;
      if (existing.status === 'CLOSED') {
        throw new BadRequestException('A closed academic year cannot be made active again');
      }
      const closed = await db.academicYear.updateMany({
        where: { institutionId: existing.institutionId, status: 'ACTIVE' },
        data: { status: 'CLOSED' },
      });
      const year = await db.academicYear.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.audit.log(db, actor, {
        action: 'activate',
        entity: 'academic_year',
        entityId: id,
        ...place,
        details: { name: year.name, closedPrevious: closed.count > 0 },
      });
      return year;
    });
  }

  /** Only a PLANNED year can be deleted (an active or closed one has history). */
  delete(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findYear(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.year.delete', place);
      if (existing.status !== 'PLANNED') {
        throw new BadRequestException('Only a planned academic year can be deleted');
      }
      await db.academicYear.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'academic_year',
        entityId: id,
        ...place,
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

  private async findInstitution(db: Db, organizationId: string, id: string) {
    const institution = await db.institution.findFirst({ where: { id, organizationId } });
    if (!institution) throw new NotFoundException('Institution not found');
    return institution;
  }

  /** Two years of one institution may not share any day. */
  private async checkNoOverlap(
    db: Db,
    institutionId: string,
    dates: { startsOn: Date; endsOn: Date },
    exceptId?: string,
  ) {
    const where: Prisma.AcademicYearWhereInput = {
      institutionId,
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

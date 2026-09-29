/**
 * The tenant admin's view of their own organization: details, dashboard numbers,
 * institutions and campuses.
 *
 * Every query runs in forOrganization(organizationId) AND filters by organizationId, so a user
 * only ever sees their own organization's data. Asking for another organization's record gives
 * "404 Not Found", never its data.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateCampusDto,
  CreateInstitutionDto,
  UpdateCampusDto,
  UpdateInstitutionDto,
  UpdateOwnOrganizationDto,
} from './dto/institution.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- The organization ------------------------------------------------------------------------

  getOwn(organizationId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const organization = await db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { modules: { where: { enabled: true }, include: { module: true } } },
      });
      const { modules, ...rest } = organization;
      return { ...rest, modules: modules.map((m) => ({ key: m.module.key, name: m.module.name })) };
    });
  }

  updateOwn(organizationId: string, dto: UpdateOwnOrganizationDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const organization = await db.organization.update({
        where: { id: organizationId },
        data: dto,
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'organization',
        entityId: organizationId,
        details: { ...dto },
      });
      return organization;
    });
  }

  /** Numbers for the tenant admin dashboard. */
  dashboard(organizationId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const where = { organizationId };
      const [institutions, campuses, users, activeUsers, roles] = await Promise.all([
        db.institution.count({ where }),
        db.campus.count({ where }),
        db.user.count({ where }),
        db.user.count({ where: { ...where, status: 'ACTIVE' } }),
        db.role.count({ where }),
      ]);
      return { institutions, campuses, users, activeUsers, roles };
    });
  }

  // --- Institutions ----------------------------------------------------------------------------

  listInstitutions(organizationId: string) {
    return this.prisma.forOrganization(organizationId, (db) =>
      db.institution.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { campuses: true } } },
      }),
    );
  }

  getInstitution(organizationId: string, id: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.findFirst({
        where: { id, organizationId },
        include: { campuses: { orderBy: { name: 'asc' } } },
      });
      if (!institution) throw new NotFoundException('Institution not found');
      return institution;
    });
  }

  createInstitution(organizationId: string, dto: CreateInstitutionDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.create({ data: { ...dto, organizationId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'institution',
        entityId: institution.id,
        details: { name: institution.name, code: institution.code },
      });
      return institution;
    });
  }

  updateInstitution(
    organizationId: string,
    id: string,
    dto: UpdateInstitutionDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, id);
      const institution = await db.institution.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'institution',
        entityId: id,
        details: { ...dto },
      });
      return institution;
    });
  }

  deleteInstitution(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, id);
      if ((await db.campus.count({ where: { institutionId: id } })) > 0) {
        throw new BadRequestException('Delete the campuses of this institution first');
      }
      await db.institution.delete({ where: { id } });
      await this.audit.log(db, actor, { action: 'delete', entity: 'institution', entityId: id });
      return { deleted: true };
    });
  }

  // --- Campuses --------------------------------------------------------------------------------

  createCampus(
    organizationId: string,
    institutionId: string,
    dto: CreateCampusDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, institutionId);
      const campus = await db.campus.create({ data: { ...dto, organizationId, institutionId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'campus',
        entityId: campus.id,
        details: { name: campus.name, code: campus.code, institutionId },
      });
      return campus;
    });
  }

  updateCampus(organizationId: string, id: string, dto: UpdateCampusDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findCampus(db, organizationId, id);
      const campus = await db.campus.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'campus',
        entityId: id,
        details: { ...dto },
      });
      return campus;
    });
  }

  deleteCampus(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findCampus(db, organizationId, id);
      await db.campus.delete({ where: { id } });
      await this.audit.log(db, actor, { action: 'delete', entity: 'campus', entityId: id });
      return { deleted: true };
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  /** Throws 404 unless the institution exists AND belongs to this organization. */
  private async findInstitution(db: Db, organizationId: string, id: string) {
    const institution = await db.institution.findFirst({ where: { id, organizationId } });
    if (!institution) throw new NotFoundException('Institution not found');
    return institution;
  }

  private async findCampus(db: Db, organizationId: string, id: string) {
    const campus = await db.campus.findFirst({ where: { id, organizationId } });
    if (!campus) throw new NotFoundException('Campus not found');
    return campus;
  }
}

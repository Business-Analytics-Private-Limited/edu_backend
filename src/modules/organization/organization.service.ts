/**
 * The tenant admin's view of their own organization: details, dashboard numbers,
 * institutions and campuses.
 *
 * Every query runs in forOrganization(organizationId) AND filters by organizationId, so a user
 * only ever sees their own organization's data. Asking for another organization's record gives
 * "404 Not Found", never its data.
 *
 * Inside the organization, each action is also checked at the record's PLACE (ADR-0018):
 * a Principal of one institution can edit that institution, not another; a Campus admin sees
 * only their own campus. Creating institutions and editing the organization need the
 * permission for the whole organization.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { can, describePlace, Place, reachOf } from '../../common/scope';
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
    assertCan(actor, 'platform.organization.update', {});
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

  /**
   * Numbers for the dashboard: for the whole organization, or, for someone whose roles all
   * apply to institutions / campuses, only for those places.
   */
  dashboard(organizationId: string, actor: CurrentUser) {
    const wholeOrganization = actor.grants.some((g) => !g.institutionId && !g.campusId);
    const institutionIds = actor.grants.filter((g) => g.institutionId).map((g) => g.institutionId!);
    const campusIds = actor.grants.filter((g) => g.campusId).map((g) => g.campusId!);
    const onlyOwnInstitutions = actor.grants
      .filter((g) => g.institutionId && !g.campusId)
      .map((g) => g.institutionId!);

    const institutionWhere: Prisma.InstitutionWhereInput = wholeOrganization
      ? { organizationId }
      : { organizationId, id: { in: institutionIds } };
    const campusWhere: Prisma.CampusWhereInput = wholeOrganization
      ? { organizationId }
      : {
          organizationId,
          OR: [{ id: { in: campusIds } }, { institutionId: { in: onlyOwnInstitutions } }],
        };
    const userWhere: Prisma.UserWhereInput = wholeOrganization
      ? { organizationId }
      : {
          organizationId,
          roles: {
            some: {
              OR: [{ campusId: { in: campusIds } }, { institutionId: { in: onlyOwnInstitutions } }],
            },
          },
        };

    return this.prisma.forOrganization(organizationId, async (db) => {
      const [institutions, campuses, users, activeUsers, roles] = await Promise.all([
        db.institution.count({ where: institutionWhere }),
        db.campus.count({ where: campusWhere }),
        db.user.count({ where: userWhere }),
        db.user.count({ where: { ...userWhere, status: 'ACTIVE' } }),
        db.role.count({ where: { organizationId } }),
      ]);
      return { institutions, campuses, users, activeUsers, roles };
    });
  }

  // --- Institutions ----------------------------------------------------------------------------

  /**
   * The institutions the user may see, each with the campuses they may see (a Campus admin
   * sees their institution with only their own campus).
   */
  listInstitutions(organizationId: string, actor: CurrentUser) {
    const reach = reachOf(actor, 'platform.institution.view');
    const where: Prisma.InstitutionWhereInput = reach.everywhere
      ? { organizationId }
      : {
          organizationId,
          OR: [
            { id: { in: reach.institutionIds } },
            { campuses: { some: { id: { in: reach.campusIds } } } },
          ],
        };
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institutions = await db.institution.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          campuses: { orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } },
        },
      });
      return institutions.map((institution) => {
        const campuses = institution.campuses.filter((campus) =>
          can(actor, 'platform.institution.view', {
            institutionId: institution.id,
            campusId: campus.id,
          }),
        );
        return { ...institution, campuses, _count: { campuses: campuses.length } };
      });
    });
  }

  getInstitution(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.findFirst({
        where: { id, organizationId },
        include: { campuses: { orderBy: { name: 'asc' } } },
      });
      if (!institution) throw new NotFoundException('Institution not found');
      const campuses = institution.campuses.filter((campus) =>
        can(actor, 'platform.institution.view', { institutionId: id, campusId: campus.id }),
      );
      // Not allowed to see the institution nor any of its campuses: as if it didn't exist.
      if (
        !can(actor, 'platform.institution.view', { institutionId: id }) &&
        campuses.length === 0
      ) {
        throw new NotFoundException('Institution not found');
      }
      return { ...institution, campuses };
    });
  }

  createInstitution(organizationId: string, dto: CreateInstitutionDto, actor: CurrentUser) {
    assertCan(actor, 'platform.institution.create', {});
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.create({ data: { ...dto, organizationId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'institution',
        entityId: institution.id,
        institutionId: institution.id,
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
      assertCan(actor, 'platform.institution.update', { institutionId: id });
      const institution = await db.institution.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'institution',
        entityId: id,
        institutionId: id,
        details: { ...dto },
      });
      return institution;
    });
  }

  deleteInstitution(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findInstitution(db, organizationId, id);
      assertCan(actor, 'platform.institution.delete', { institutionId: id });
      if ((await db.campus.count({ where: { institutionId: id } })) > 0) {
        throw new BadRequestException('Delete the campuses of this institution first');
      }
      if ((await db.userRole.count({ where: { institutionId: id } })) > 0) {
        throw new BadRequestException(
          'Some users still have roles in this institution; take those roles away first',
        );
      }
      await db.institution.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'institution',
        entityId: id,
        institutionId: id,
      });
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
      assertCan(actor, 'platform.campus.create', { institutionId });
      const campus = await db.campus.create({ data: { ...dto, organizationId, institutionId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'campus',
        entityId: campus.id,
        institutionId,
        campusId: campus.id,
        details: { name: campus.name, code: campus.code, institutionId },
      });
      return campus;
    });
  }

  updateCampus(organizationId: string, id: string, dto: UpdateCampusDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findCampus(db, organizationId, id);
      const place = { institutionId: existing.institutionId, campusId: id };
      assertCan(actor, 'platform.campus.update', place);
      const campus = await db.campus.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'campus',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return campus;
    });
  }

  deleteCampus(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findCampus(db, organizationId, id);
      const place = { institutionId: existing.institutionId, campusId: id };
      assertCan(actor, 'platform.campus.delete', place);
      if ((await db.userRole.count({ where: { campusId: id } })) > 0) {
        throw new BadRequestException(
          'Some users still have roles at this campus; take those roles away first',
        );
      }
      await db.campus.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'campus',
        entityId: id,
        ...place,
      });
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

/** Throws 403 unless the user has `permission` at `place` (see src/common/scope.ts). */
function assertCan(actor: CurrentUser, permission: string, place: Place) {
  if (!can(actor, permission, place)) {
    throw new ForbiddenException(
      `Your roles don't allow "${permission}" for ${describePlace(place)}`,
    );
  }
}

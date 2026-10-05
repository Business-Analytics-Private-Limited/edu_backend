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
 * only their own campus. Editing the organization needs the permission for the whole
 * organization. Institutions are added and deleted only by the super admin (ADR-0025,
 * institution-records.ts); here they can be viewed and renamed.
 *
 * Campuses are DEACTIVATED instead of deleted (ADR-0026): the records stay, nothing new happens
 * there (places-in-use.ts), and only the Organization admin activates them again. A real delete
 * is only for an empty campus added by mistake, and only by the Organization admin.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, reachOf } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { activeStudentCount, assertInstitutionInUse } from './places-in-use';
import {
  CreateCampusDto,
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
      const [
        institutions,
        inactiveInstitutions,
        campuses,
        inactiveCampuses,
        users,
        activeUsers,
        roles,
      ] = await Promise.all([
        db.institution.count({ where: { ...institutionWhere, status: 'ACTIVE' } }),
        db.institution.count({ where: { ...institutionWhere, status: 'INACTIVE' } }),
        db.campus.count({ where: { ...campusWhere, status: 'ACTIVE' } }),
        db.campus.count({ where: { ...campusWhere, status: 'INACTIVE' } }),
        db.user.count({ where: userWhere }),
        db.user.count({ where: { ...userWhere, status: 'ACTIVE' } }),
        db.role.count({ where: { organizationId } }),
      ]);
      // institutions / campuses = the active ones; closed ones are counted separately (ADR-0026).
      return {
        institutions,
        inactiveInstitutions,
        campuses,
        inactiveCampuses,
        users,
        activeUsers,
        roles,
      };
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
          campuses: {
            orderBy: { name: 'asc' },
            select: { id: true, name: true, code: true, status: true },
          },
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
      await assertInstitutionInUse(db, institutionId);
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

  /**
   * Closes a campus (ADR-0026): its records stay and can be read, nothing new happens there, and
   * roles given at it stop working. Refused while active students still study there.
   */
  deactivateCampus(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findCampus(db, organizationId, id);
      const place = { institutionId: existing.institutionId, campusId: id };
      assertCan(actor, 'platform.campus.delete', place);
      if (existing.status === 'INACTIVE') {
        throw new BadRequestException(`Campus ${existing.name} is already inactive`);
      }
      const students = await activeStudentCount(db, { campusId: id });
      if (students > 0) {
        throw new BadRequestException(
          `${students} active student(s) still study at ${existing.name}; move them to another campus or change their status first`,
        );
      }
      const campus = await db.campus.update({ where: { id }, data: { status: 'INACTIVE' } });
      await this.audit.log(db, actor, {
        action: 'deactivate',
        entity: 'campus',
        entityId: id,
        ...place,
        details: { name: existing.name },
      });
      return campus;
    });
  }

  /** Opens a closed campus again. Only the Organization admin may (ADR-0026). */
  activateCampus(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      if (!actor.isOrganizationAdmin) {
        throw new ForbiddenException('Only the Organization admin can activate a campus');
      }
      const existing = await this.findCampus(db, organizationId, id);
      await assertInstitutionInUse(db, existing.institutionId);
      if (existing.status === 'ACTIVE') {
        throw new BadRequestException(`Campus ${existing.name} is already active`);
      }
      const campus = await db.campus.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.audit.log(db, actor, {
        action: 'activate',
        entity: 'campus',
        entityId: id,
        institutionId: existing.institutionId,
        campusId: id,
        details: { name: existing.name },
      });
      return campus;
    });
  }

  /**
   * Really deletes a campus: only an EMPTY one (e.g. added by mistake), and only by the
   * Organization admin. Anything with data is deactivated instead.
   */
  deleteCampus(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      if (!actor.isOrganizationAdmin) {
        throw new ForbiddenException(
          'Only the Organization admin can delete a campus; deactivate it instead',
        );
      }
      const existing = await this.findCampus(db, organizationId, id);
      if ((await db.userRole.count({ where: { campusId: id } })) > 0) {
        throw new BadRequestException(
          'Some users still have roles at this campus; take those roles away first',
        );
      }
      const [classes, students, holidays] = await Promise.all([
        db.class.count({ where: { campusId: id } }),
        db.student.count({ where: { campusId: id } }),
        db.holiday.count({ where: { campusId: id } }),
      ]);
      if (classes + students + holidays > 0) {
        throw new BadRequestException(
          'Only an empty campus can be deleted (no classes, students or holidays); deactivate it instead',
        );
      }
      await db.campus.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'campus',
        entityId: id,
        institutionId: existing.institutionId,
        details: { name: existing.name, code: existing.code },
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

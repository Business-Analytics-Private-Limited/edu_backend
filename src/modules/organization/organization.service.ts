/**
 * The organization's own area: its details and settings, the dashboard, and its branches.
 *
 * Every query runs in forOrganization(organizationId) AND filters by organizationId, so a user
 * only ever sees their own organization's data. Asking for another organization's record gives
 * "404 Not Found", never its data.
 *
 * Branches (ADR-0030) are added, closed and deleted only by the super admin (super-admin module);
 * here they are listed and renamed. A Branch admin sees their own branch only.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, reachOf } from '../../common/scope';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PRESETS } from '../academic/presets';
import { UpdateBranchDto, UpdateOwnOrganizationDto } from './dto/organization.dto';
import { findBranch } from './places-in-use';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- The organization ------------------------------------------------------------------------

  /** Details, type, settings and the switched-on modules. */
  getOwn(organizationId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const organization = await db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { modules: { where: { enabled: true }, include: { module: true } } },
      });
      const { modules, ...rest } = organization;
      return {
        ...rest,
        yearLevel: PRESETS[organization.type].yearLevel,
        modules: modules.map((m) => ({ key: m.module.key, name: m.module.name })),
      };
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
   * apply to branches, only for those branches.
   */
  dashboard(organizationId: string, actor: CurrentUser) {
    const wholeOrganization = actor.grants.some((g) => !g.branchId);
    const branchIds = [...new Set(actor.grants.map((g) => g.branchId).filter(Boolean))] as string[];
    const branchWhere: Prisma.BranchWhereInput = wholeOrganization
      ? { organizationId }
      : { organizationId, id: { in: branchIds } };
    const userWhere: Prisma.UserWhereInput = wholeOrganization
      ? { organizationId, kind: 'STAFF' }
      : { organizationId, kind: 'STAFF', roles: { some: { branchId: { in: branchIds } } } };
    const studentWhere: Prisma.StudentWhereInput = wholeOrganization
      ? { organizationId }
      : { organizationId, branchId: { in: branchIds } };
    const students = actor.enabledModules.includes('students');

    return this.prisma.forOrganization(organizationId, async (db) => {
      const [branches, inactiveBranches, users, activeUsers, roles, current, outgoing] =
        await Promise.all([
          db.branch.count({ where: { ...branchWhere, status: 'ACTIVE' } }),
          db.branch.count({ where: { ...branchWhere, status: 'INACTIVE' } }),
          db.user.count({ where: userWhere }),
          db.user.count({ where: { ...userWhere, status: 'ACTIVE' } }),
          db.role.count({ where: { organizationId } }),
          students ? db.student.count({ where: { ...studentWhere, status: 'ACTIVE' } }) : 0,
          students
            ? db.student.count({ where: { ...studentWhere, status: { not: 'ACTIVE' } } })
            : 0,
        ]);
      // branches = the active ones; closed ones are counted separately (ADR-0026).
      return {
        branches,
        inactiveBranches,
        users,
        activeUsers,
        roles,
        students: students ? { current, outgoing } : null,
      };
    });
  }

  // --- Branches --------------------------------------------------------------------------------

  /** The branches the user may see, with their number of current students. */
  listBranches(organizationId: string, actor: CurrentUser) {
    const reach = reachOf(actor, 'platform.branch.view');
    const where: Prisma.BranchWhereInput = reach.everywhere
      ? { organizationId }
      : { organizationId, id: { in: reach.branchIds } };
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branches = await db.branch.findMany({ where, orderBy: { name: 'asc' } });
      const counts = await db.student.groupBy({
        by: ['branchId'],
        where: { organizationId, status: 'ACTIVE' },
        _count: { _all: true },
      });
      return branches.map((b) => ({
        ...b,
        students: counts.find((c) => c.branchId === b.id)?._count._all ?? 0,
      }));
    });
  }

  getBranch(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branch = await findBranch(db, organizationId, id);
      // Not allowed to see it: as if it didn't exist.
      if (!can(actor, 'platform.branch.view', { branchId: id })) {
        throw new NotFoundException('Branch not found');
      }
      return branch;
    });
  }

  updateBranch(organizationId: string, id: string, dto: UpdateBranchDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await findBranch(db, organizationId, id);
      const place = { branchId: id };
      assertCan(actor, 'platform.branch.update', place);
      const branch = await db.branch.update({ where: { id }, data: { name: dto.name } });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'branch',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return branch;
    });
  }
}

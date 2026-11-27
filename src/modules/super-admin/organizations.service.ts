/**
 * What the super admin can do with organizations: list, create (with its type, first admin and
 * branches), view, edit, suspend / activate, switch modules on and off, add, close, reopen
 * and delete branches (only the super admin does that, ADR-0030), and reset an organization
 * admin's password when nobody in the organization can (ADR-0036).
 *
 * Super admins work across all organizations, so every query runs in forAllOrganizations.
 * Every change is written to the audit log in the same transaction.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { PRESETS } from '../academic/presets';
import { giveBranchAllGroups } from '../academic/branch-groups';
import { ensurePresets } from '../academic/structure.service';
import { AuditService } from '../audit/audit.service';
import { CreateBranchDto } from '../organization/dto/organization.dto';
import { activeStudentCount } from '../organization/places-in-use';
import { ORG_ADMIN } from '../roles/predefined-roles';
import { PredefinedRolesService } from '../roles/predefined-roles.service';
import {
  CreateOrganizationDto,
  ListOrganizationsQuery,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { issueTemporaryPassword } from '../users/temporary-password';
import { checkModuleChange } from './module-rules';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly predefinedRoles: PredefinedRolesService,
  ) {}

  /** Numbers for the super admin dashboard. */
  dashboard() {
    return this.prisma.forAllOrganizations(async (db) => {
      const [total, active, suspended, users, branches, recent] = await Promise.all([
        db.organization.count(),
        db.organization.count({ where: { status: 'ACTIVE' } }),
        db.organization.count({ where: { status: 'SUSPENDED' } }),
        db.user.count({ where: { kind: 'STAFF' } }),
        db.branch.count(),
        db.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      ]);
      return {
        organizations: { total, active, suspended },
        users,
        branches,
        recentOrganizations: recent,
      };
    });
  }

  /** The modules that can be switched on for organizations. */
  modules() {
    return this.prisma.module.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  list(query: ListOrganizationsQuery) {
    const where: Prisma.OrganizationWhereInput = {
      status: query.status,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { slug: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    return this.prisma.forAllOrganizations(async (db) => {
      const [items, total] = await Promise.all([
        db.organization.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { users: true, branches: true } } },
          ...toSkipTake(query),
        }),
        db.organization.count({ where }),
      ]);
      return paginated(items, total, query);
    });
  }

  /**
   * Creates an organization together with:
   *   - every predefined role (the first admin gets "Organization admin"),
   *   - its first admin user,
   *   - its branches, and
   *   - what its type always has (Intermediate: Junior, Senior, Long Term).
   */
  create(dto: CreateOrganizationDto, actor: CurrentUser) {
    const codes = dto.branches.map((b) => b.code);
    const repeated = codes.find((code, index) => codes.indexOf(code) !== index);
    if (repeated) throw new BadRequestException(`Branch code ${repeated} is used twice`);

    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          code: dto.code,
          type: dto.type,
          levelNames: PRESETS[dto.type].levels,
          contactName: dto.contactName,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
        },
      });
      // Every predefined role (Organization admin, Director, ...); the first admin gets the first.
      const roles = await this.predefinedRoles.copyToOrganization(db, organization.id);
      const admin = await db.user.create({
        data: {
          organizationId: organization.id,
          roles: { create: { roleId: roles[ORG_ADMIN], organizationId: organization.id } },
          name: dto.admin.name,
          email: dto.admin.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.admin.password, 10),
        },
      });
      await ensurePresets(db, organization);
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'organization',
        entityId: organization.id,
        organizationId: organization.id,
        details: {
          name: organization.name,
          slug: organization.slug,
          type: organization.type,
          adminEmail: admin.email,
        },
      });
      for (const item of dto.branches) {
        await this.createBranch(db, organization.id, item, actor);
      }
      return { ...organization, admin: { id: admin.id, name: admin.name, email: admin.email } };
    });
  }

  /** One organization with its modules (on / off), branches, counts and admins. */
  async get(id: string) {
    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.findUnique({
        where: { id },
        include: {
          modules: true,
          _count: { select: { users: true, branches: true, roles: true, classes: true } },
        },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      const allModules = await db.module.findMany({ orderBy: { sortOrder: 'asc' } });
      const branches = await db.branch.findMany({
        where: { organizationId: id },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, status: true },
      });
      const admins = await db.user.findMany({
        where: { organizationId: id, roles: { some: { role: { templateKey: ORG_ADMIN } } } },
        select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      });
      const { modules: switchedModules, ...rest } = organization;
      return {
        ...rest,
        admins,
        branches,
        modules: allModules.map((module) => ({
          ...module,
          enabled: switchedModules.some((m) => m.moduleKey === module.key && m.enabled),
        })),
      };
    });
  }

  update(id: string, dto: UpdateOrganizationDto, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const existing = await db.organization.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Organization not found');
      const typeChanges = dto.type !== undefined && dto.type !== existing.type;
      if (typeChanges) {
        // The structure follows the type: change it only while there is nothing to fit.
        const built = await db.class.count({ where: { organizationId: id, builtIn: false } });
        const students = await db.student.count({ where: { organizationId: id } });
        if (built + students > 0) {
          throw new BadRequestException(
            'The type can only change while the organization has no academic structure and no students',
          );
        }
        await db.class.deleteMany({ where: { organizationId: id, branchId: null } });
      }
      const organization = await db.organization.update({
        where: { id },
        data: { ...dto, ...(typeChanges && { levelNames: PRESETS[dto.type!].levels }) },
      });
      if (typeChanges) await ensurePresets(db, organization);
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'organization',
        entityId: id,
        organizationId: id,
        details: { ...dto },
      });
      return organization;
    });
  }

  /** Suspended organizations can't log in; their data is kept. */
  setStatus(id: string, status: OrganizationStatus, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.update({ where: { id }, data: { status } });
      await this.audit.log(db, actor, {
        action: status === 'SUSPENDED' ? 'suspend' : 'activate',
        entity: 'organization',
        entityId: id,
        organizationId: id,
      });
      return organization;
    });
  }

  /**
   * Resets an organization admin's password (ADR-0036), e.g. when the only admin forgot it.
   * Only for the organization's admins: everyone else is reset by their own admins.
   */
  resetAdminPassword(id: string, userId: string, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const admin = await db.user.findFirst({
        where: {
          id: userId,
          organizationId: id,
          roles: { some: { role: { templateKey: ORG_ADMIN } } },
        },
        select: { id: true, name: true, email: true },
      });
      if (!admin) throw new NotFoundException('No such admin in this organization');
      const temporaryPassword = await issueTemporaryPassword(db, admin.id);
      // Never the password itself in the log.
      await this.audit.log(db, actor, {
        action: 'reset password',
        entity: 'user',
        entityId: admin.id,
        organizationId: id,
        details: { user: admin.name },
      });
      return { user: admin, temporaryPassword };
    });
  }

  /** Switches a module on or off for an organization, following the dependency rules. */
  setModule(id: string, moduleKey: string, enabled: boolean, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.findUnique({
        where: { id },
        include: { modules: { where: { enabled: true } } },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      const allModules = await db.module.findMany();
      const module = allModules.find((m) => m.key === moduleKey);
      if (!module) throw new NotFoundException(`No module "${moduleKey}"`);

      const enabledKeys = organization.modules.map((m) => m.moduleKey);
      const problem = checkModuleChange(module, enabled, allModules, enabledKeys);
      if (problem) throw new BadRequestException(problem);

      await db.organizationModule.upsert({
        where: { organizationId_moduleKey: { organizationId: id, moduleKey } },
        update: { enabled },
        create: { organizationId: id, moduleKey, enabled },
      });
      await this.audit.log(db, actor, {
        action: enabled ? 'module_on' : 'module_off',
        entity: 'organization',
        entityId: id,
        organizationId: id,
        details: { module: moduleKey },
      });
      return { moduleKey, enabled };
    });
  }

  // --- Branches (ADR-0030) ---------------------------------------------------------------------

  addBranch(organizationId: string, dto: CreateBranchDto, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      if (!(await db.organization.findUnique({ where: { id: organizationId } }))) {
        throw new NotFoundException('Organization not found');
      }
      return this.createBranch(db, organizationId, dto, actor);
    });
  }

  /**
   * Closes a branch (ADR-0026): its records stay, nothing new happens there, and roles given
   * there stop working. Refused while current students study there.
   */
  deactivateBranch(organizationId: string, branchId: string, actor: CurrentUser) {
    return this.setBranchStatus(organizationId, branchId, 'INACTIVE', actor);
  }

  activateBranch(organizationId: string, branchId: string, actor: CurrentUser) {
    return this.setBranchStatus(organizationId, branchId, 'ACTIVE', actor);
  }

  /** Deletes a branch that is still empty (e.g. added by mistake); anything else is closed instead. */
  deleteBranch(organizationId: string, branchId: string, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const branch = await this.findBranch(db, organizationId, branchId);
      const [roles, sections, students, holidays] = await Promise.all([
        db.userRole.count({ where: { branchId } }),
        db.class.count({ where: { branchId } }),
        db.student.count({ where: { branchId } }),
        db.holiday.count({ where: { branchId } }),
      ]);
      if (roles > 0) {
        throw new BadRequestException(
          'Some users still have roles at this branch; take those roles away first',
        );
      }
      if (sections + students + holidays > 0) {
        throw new BadRequestException(
          'Only an empty branch can be deleted (no sections, students or holidays); deactivate it instead',
        );
      }
      await db.branch.delete({ where: { id: branchId } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'branch',
        entityId: branchId,
        organizationId,
        details: { name: branch.name, code: branch.code },
      });
      return { deleted: true };
    });
  }

  private async createBranch(
    db: Db,
    organizationId: string,
    dto: CreateBranchDto,
    actor: CurrentUser,
  ) {
    if (await db.branch.findFirst({ where: { organizationId, code: dto.code } })) {
      throw new BadRequestException(`This organization already has a branch with code ${dto.code}`);
    }
    const branch = await db.branch.create({
      data: { organizationId, name: dto.name, code: dto.code },
    });
    // Intermediate: a new branch runs every group the organization has (ADR-0032).
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { id: true, type: true },
    });
    await giveBranchAllGroups(db, organization, branch.id);
    await this.audit.log(db, actor, {
      action: 'create',
      entity: 'branch',
      entityId: branch.id,
      organizationId,
      branchId: branch.id,
      details: { name: branch.name, code: branch.code },
    });
    return branch;
  }

  private setBranchStatus(
    organizationId: string,
    branchId: string,
    status: 'ACTIVE' | 'INACTIVE',
    actor: CurrentUser,
  ) {
    return this.prisma.forAllOrganizations(async (db) => {
      const existing = await this.findBranch(db, organizationId, branchId);
      if (existing.status === status) {
        throw new BadRequestException(
          `${existing.name} is already ${status === 'ACTIVE' ? 'active' : 'inactive'}`,
        );
      }
      if (status === 'INACTIVE') {
        const students = await activeStudentCount(db, branchId);
        if (students > 0) {
          throw new BadRequestException(
            `${students} current student(s) still study at ${existing.name}; it can be deactivated once they have left or moved`,
          );
        }
      }
      const branch = await db.branch.update({ where: { id: branchId }, data: { status } });
      await this.audit.log(db, actor, {
        action: status === 'ACTIVE' ? 'activate' : 'deactivate',
        entity: 'branch',
        entityId: branchId,
        organizationId,
        branchId,
        details: { name: branch.name },
      });
      return branch;
    });
  }

  private async findBranch(db: Db, organizationId: string, branchId: string) {
    const branch = await db.branch.findFirst({ where: { id: branchId, organizationId } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }
}

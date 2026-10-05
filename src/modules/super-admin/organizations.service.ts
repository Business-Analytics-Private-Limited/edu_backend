/**
 * What the super admin can do with organizations: list, create (with its first admin and its
 * institutions), view, edit, suspend / activate, switch modules on and off, and add or delete
 * institutions (only the super admin does that, ADR-0025).
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
import { AuditService } from '../audit/audit.service';
import { CreateInstitutionDto } from '../organization/dto/institution.dto';
import { addInstitution, deleteEmptyInstitution } from '../organization/institution-records';
import { activeStudentCount } from '../organization/places-in-use';
import { ORG_ADMIN } from '../roles/predefined-roles';
import { PredefinedRolesService } from '../roles/predefined-roles.service';
import {
  CreateOrganizationDto,
  ListOrganizationsQuery,
  UpdateOrganizationDto,
} from './dto/organization.dto';
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
      const [total, active, suspended, users, institutions, recent] = await Promise.all([
        db.organization.count(),
        db.organization.count({ where: { status: 'ACTIVE' } }),
        db.organization.count({ where: { status: 'SUSPENDED' } }),
        db.user.count(),
        db.institution.count(),
        db.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      ]);
      return {
        organizations: { total, active, suspended },
        users,
        institutions,
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
          include: { _count: { select: { users: true, institutions: true } } },
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
   *   - its first admin user, and
   *   - its institutions (the admin then adds campuses, users and everything else).
   */
  create(dto: CreateOrganizationDto, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
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
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'organization',
        entityId: organization.id,
        organizationId: organization.id,
        details: { name: organization.name, slug: organization.slug, adminEmail: admin.email },
      });
      const codes = dto.institutions.map((i) => i.code);
      const repeated = codes.find((code, index) => codes.indexOf(code) !== index);
      if (repeated) throw new BadRequestException(`Institution code ${repeated} is used twice`);
      for (const item of dto.institutions) {
        await this.logInstitution(
          db,
          actor,
          'create',
          await addInstitution(db, organization.id, item),
        );
      }
      return { ...organization, admin: { id: admin.id, name: admin.name, email: admin.email } };
    });
  }

  /** One organization with its modules (on / off), counts and admins. */
  async get(id: string) {
    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.findUnique({
        where: { id },
        include: {
          modules: true,
          _count: { select: { users: true, institutions: true, campuses: true, roles: true } },
        },
      });
      if (!organization) throw new NotFoundException('Organization not found');

      const allModules = await db.module.findMany({ orderBy: { sortOrder: 'asc' } });
      const institutions = await db.institution.findMany({
        where: { organizationId: id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          code: true,
          status: true,
          _count: { select: { campuses: true } },
        },
      });
      const [activeCampuses, inactiveCampuses] = await Promise.all([
        db.campus.count({ where: { organizationId: id, status: 'ACTIVE' } }),
        db.campus.count({ where: { organizationId: id, status: 'INACTIVE' } }),
      ]);
      const admins = await db.user.findMany({
        where: { organizationId: id, roles: { some: { role: { templateKey: ORG_ADMIN } } } },
        select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      });
      const { modules: switchedModules, ...rest } = organization;
      return {
        ...rest,
        admins,
        institutions,
        campuses: { active: activeCampuses, inactive: inactiveCampuses },
        modules: allModules.map((module) => ({
          ...module,
          enabled: switchedModules.some((m) => m.moduleKey === module.key && m.enabled),
        })),
      };
    });
  }

  update(id: string, dto: UpdateOrganizationDto, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const organization = await db.organization.update({ where: { id }, data: dto });
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

  // --- Institutions (ADR-0025) -----------------------------------------------------------------

  /** Adds an institution to an existing organization. */
  addInstitution(organizationId: string, dto: CreateInstitutionDto, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      if (!(await db.organization.findUnique({ where: { id: organizationId } }))) {
        throw new NotFoundException('Organization not found');
      }
      const institution = await addInstitution(db, organizationId, dto);
      await this.logInstitution(db, actor, 'create', institution);
      return institution;
    });
  }

  /** Deletes an institution that is still empty (no campuses, roles or academic data). */
  deleteInstitution(organizationId: string, institutionId: string, actor: CurrentUser) {
    return this.prisma.forAllOrganizations(async (db) => {
      const institution = await deleteEmptyInstitution(db, organizationId, institutionId);
      await this.logInstitution(db, actor, 'delete', institution);
      return { deleted: true };
    });
  }

  /**
   * Closes an institution (ADR-0026): its records stay, nothing new happens there or at its
   * campuses, and roles given there stop working. Refused while it has active students.
   */
  deactivateInstitution(organizationId: string, institutionId: string, actor: CurrentUser) {
    return this.setInstitutionStatus(organizationId, institutionId, 'INACTIVE', actor);
  }

  activateInstitution(organizationId: string, institutionId: string, actor: CurrentUser) {
    return this.setInstitutionStatus(organizationId, institutionId, 'ACTIVE', actor);
  }

  private setInstitutionStatus(
    organizationId: string,
    institutionId: string,
    status: 'ACTIVE' | 'INACTIVE',
    actor: CurrentUser,
  ) {
    return this.prisma.forAllOrganizations(async (db) => {
      const existing = await db.institution.findFirst({
        where: { id: institutionId, organizationId },
      });
      if (!existing) throw new NotFoundException('Institution not found');
      if (existing.status === status) {
        throw new BadRequestException(
          `${existing.name} is already ${status === 'ACTIVE' ? 'active' : 'inactive'}`,
        );
      }
      if (status === 'INACTIVE') {
        const students = await activeStudentCount(db, { institutionId });
        if (students > 0) {
          throw new BadRequestException(
            `${students} active student(s) still study at ${existing.name}; it can be deactivated once they have left or moved`,
          );
        }
      }
      const institution = await db.institution.update({
        where: { id: institutionId },
        data: { status },
      });
      await this.logInstitution(
        db,
        actor,
        status === 'ACTIVE' ? 'activate' : 'deactivate',
        institution,
      );
      return institution;
    });
  }

  private logInstitution(
    db: Db,
    actor: CurrentUser,
    action: 'create' | 'delete' | 'activate' | 'deactivate',
    institution: { id: string; organizationId: string; name: string; code: string },
  ) {
    return this.audit.log(db, actor, {
      action,
      entity: 'institution',
      entityId: institution.id,
      organizationId: institution.organizationId,
      // A deleted institution can't be linked to any more.
      institutionId: action === 'delete' ? undefined : institution.id,
      details: { name: institution.name, code: institution.code },
    });
  }
}

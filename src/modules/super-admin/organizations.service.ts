/**
 * What the super admin can do with organizations: list, create (with its first admin), view,
 * edit, suspend / activate, and switch modules on and off.
 *
 * Super admins work across all organizations, so every query runs in forAllOrganizations.
 * Every change is written to the audit log in the same transaction.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationStatus, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
   *   - an "Organization admin" role with every permission, and
   *   - its first admin user (who can then create everything else).
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
      const admins = await db.user.findMany({
        where: { organizationId: id, roles: { some: { role: { templateKey: ORG_ADMIN } } } },
        select: { id: true, name: true, email: true, status: true, lastLoginAt: true },
      });
      const { modules: switchedModules, ...rest } = organization;
      return {
        ...rest,
        admins,
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
}

/**
 * Roles of an organization: a name and a list of permissions.
 *
 * Two kinds:
 *   - PREDEFINED roles (Organization admin, Director, Principal, ...): the same in every
 *     organization, managed by the super admin (predefined-roles.service.ts). Here they can only
 *     be looked at, and assigned to users.
 *   - the organization's OWN roles: created, edited and deleted here.
 *
 * Rules for own roles:
 *   - permissions must come from the list in permissions.ts;
 *   - roles are the same across the organization, so creating, editing and deleting them needs
 *     the permission for the WHOLE organization (a Campus admin only gives existing roles);
 *   - you can only put permissions in a role that you have yourself (for the whole
 *     organization), and only change roles that don't have more than you;
 *   - a role that users still have can't be deleted.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { canEverywhere, missingAt } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { isKnownPermission, RESOURCES } from './permissions';

const PREDEFINED_IS_LOCKED = 'Predefined roles can only be changed by EduPlatform';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every resource and its actions, for the permission grid, with `available: false` where the
   * module is switched off for this organization (such permissions do nothing until it is on).
   */
  permissionCatalog(enabledModules: string[]) {
    return RESOURCES.map((r) => ({
      ...r,
      available: r.module === null || enabledModules.includes(r.module),
    }));
  }

  /** Predefined roles first (in their fixed order), then the organization's own, by name. */
  list(organizationId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const roles = await db.role.findMany({
        where: { organizationId },
        include: { template: true, _count: { select: { users: true } } },
        orderBy: { name: 'asc' },
      });
      const order = (r: (typeof roles)[number]) => r.template?.sortOrder ?? 1000;
      return roles.sort((a, b) => order(a) - order(b)).map(toPublicRole);
    });
  }

  get(organizationId: string, id: string) {
    return this.prisma.forOrganization(organizationId, async (db) =>
      toPublicRole(await this.findRole(db, organizationId, id)),
    );
  }

  create(organizationId: string, dto: CreateRoleDto, actor: CurrentUser) {
    assertWholeOrganization(actor, 'access.role.create');
    this.checkPermissions(dto.permissions, actor);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const role = await db.role.create({ data: { ...dto, organizationId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'role',
        entityId: role.id,
        details: { name: role.name, permissions: role.permissions },
      });
      return role;
    });
  }

  update(organizationId: string, id: string, dto: UpdateRoleDto, actor: CurrentUser) {
    assertWholeOrganization(actor, 'access.role.update');
    if (dto.permissions) this.checkPermissions(dto.permissions, actor);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findRole(db, organizationId, id);
      if (existing.templateKey) throw new ForbiddenException(PREDEFINED_IS_LOCKED);
      if (missingAt(actor, existing.permissions, {}).length > 0) {
        throw new ForbiddenException(
          "This role has permissions you don't have, so you can't change it",
        );
      }
      const role = await db.role.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'role',
        entityId: id,
        details: { before: existing.permissions, after: role.permissions, name: role.name },
      });
      return role;
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertWholeOrganization(actor, 'access.role.delete');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const role = await this.findRole(db, organizationId, id);
      if (role.templateKey) throw new ForbiddenException(PREDEFINED_IS_LOCKED);
      if ((await db.userRole.count({ where: { roleId: id } })) > 0) {
        throw new BadRequestException(
          'Some users still have this role; take it away from them first',
        );
      }
      await db.role.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'role',
        entityId: id,
        details: { name: role.name },
      });
      return { deleted: true };
    });
  }

  private async findRole(db: Db, organizationId: string, id: string) {
    const role = await db.role.findFirst({
      where: { id, organizationId },
      include: { template: true, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private checkPermissions(permissions: string[], actor: CurrentUser) {
    const unknown = permissions.filter((p) => !isKnownPermission(p));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
    }
    const notYours = missingAt(actor, permissions, {});
    if (notYours.length > 0) {
      throw new ForbiddenException(
        `You can only give permissions you have yourself. Not yours: ${notYours.join(', ')}`,
      );
    }
  }
}

/** Roles are organization-wide: managing them needs `permission` for the whole organization. */
function assertWholeOrganization(actor: CurrentUser, permission: string) {
  if (!canEverywhere(actor, permission)) {
    throw new ForbiddenException(
      'Roles are shared by the whole organization; only someone with this permission for the whole organization can change them',
    );
  }
}

/** A role as the API sends it: with "predefined" and "assignable" spelled out. */
function toPublicRole(role: {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  templateKey: string | null;
  template: { assignable: boolean } | null;
  _count: { users: number };
}) {
  const { template, ...rest } = role;
  return {
    ...rest,
    /** true = the same in every organization; only EduPlatform can change it. */
    predefined: role.templateKey !== null,
    /** false = can't be given from the Users page (Parent, Student). */
    assignable: template?.assignable ?? true,
  };
}

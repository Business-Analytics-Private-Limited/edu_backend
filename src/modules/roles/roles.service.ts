/**
 * Roles of an organization: a name and a list of permissions.
 *
 * Two kinds:
 *   - PREDEFINED roles (Organization admin, Director, Principal, ...): every organization has
 *     a copy, kept up to date by the super admin (predefined-roles.service.ts). The organization
 *     may change a copy's PERMISSIONS (not its name); it then counts as "customized" and the
 *     super admin's later changes no longer overwrite it, until "reset" puts EduPlatform's
 *     version back (ADR-0029). They can't be deleted. Locked completely: Organization admin
 *     (always every permission, so nobody locks themselves out) and Parent / Student (portal
 *     logins have no permissions).
 *   - the organization's OWN roles: created, edited and deleted here.
 *
 * Rules for both:
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
import { ORG_ADMIN } from './predefined-roles';

const PREDEFINED_CANT_BE_DELETED = 'Predefined roles cannot be deleted';

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
      const predefined = existing.templateKey !== null;
      if (predefined) {
        checkEditable(existing);
        if (dto.name !== undefined || dto.description !== undefined) {
          throw new BadRequestException(
            'A predefined role keeps its name and description; only its permissions can change',
          );
        }
        if (!dto.permissions) throw new BadRequestException("Send the role's permissions");
      }
      if (missingAt(actor, existing.permissions, {}).length > 0) {
        throw new ForbiddenException(
          "This role has permissions you don't have, so you can't change it",
        );
      }
      const role = await db.role.update({
        where: { id },
        // A predefined role changed here is "customized" (ADR-0029).
        data: predefined ? { permissions: dto.permissions, customized: true } : dto,
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'role',
        entityId: id,
        details: {
          before: existing.permissions,
          after: role.permissions,
          name: role.name,
          ...(predefined ? { predefined: true } : {}),
        },
      });
      return role;
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertWholeOrganization(actor, 'access.role.delete');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const role = await this.findRole(db, organizationId, id);
      if (role.templateKey) throw new ForbiddenException(PREDEFINED_CANT_BE_DELETED);
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

  /**
   * Puts a customized predefined role back to EduPlatform's current version (the super admin's
   * permissions) and lets it follow the super admin's changes again (ADR-0029).
   */
  resetToDefault(organizationId: string, id: string, actor: CurrentUser) {
    assertWholeOrganization(actor, 'access.role.update');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findRole(db, organizationId, id);
      if (!existing.template) throw new BadRequestException('Only predefined roles can be reset');
      checkEditable(existing);
      const role = await db.role.update({
        where: { id },
        data: { permissions: existing.template.permissions, customized: false },
        include: { template: true, _count: { select: { users: true } } },
      });
      await this.audit.log(db, actor, {
        action: 'reset',
        entity: 'role',
        entityId: id,
        details: { name: role.name, before: existing.permissions, after: role.permissions },
      });
      return toPublicRole(role);
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

/**
 * Predefined roles whose permissions the organization may change: all but the Organization
 * admin and the portal roles (Parent, Student).
 */
function isEditable(role: {
  templateKey: string | null;
  template: { assignable: boolean } | null;
}) {
  if (role.templateKey === null) return true;
  return role.templateKey !== ORG_ADMIN && (role.template?.assignable ?? true);
}

function checkEditable(role: {
  templateKey: string | null;
  template: { assignable: boolean } | null;
}) {
  if (role.templateKey === ORG_ADMIN) {
    throw new ForbiddenException('The Organization admin always has every permission');
  }
  if (!isEditable(role)) {
    throw new ForbiddenException(
      'Parent and Student roles are for portal logins, which have no permissions to change',
    );
  }
}

/** A role as the API sends it: with "predefined", "assignable" and "editable" spelled out. */
function toPublicRole(role: {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  templateKey: string | null;
  customized: boolean;
  template: { assignable: boolean; permissions: string[] } | null;
  _count: { users: number };
}) {
  const { template, ...rest } = role;
  return {
    ...rest,
    /** true = every organization has it, kept up to date by EduPlatform unless customized. */
    predefined: role.templateKey !== null,
    /** false = can't be given from the Users page (Parent, Student). */
    assignable: template?.assignable ?? true,
    /** Its permissions can be changed here (not the Organization admin, Parent, Student). */
    editable: isEditable(role),
    /** EduPlatform's current permissions for a predefined role, to compare with. */
    defaultPermissions: template?.permissions ?? null,
  };
}

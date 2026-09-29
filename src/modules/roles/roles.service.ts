/**
 * Roles of an organization, e.g. "Teacher" or "Office staff": a name and a list of permissions.
 *
 * Rules:
 *   - permissions must come from the list in permissions.ts;
 *   - the "Organization admin" role (isSystem) can't be changed or deleted;
 *   - a role that users still have can't be deleted.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { isKnownPermission, PERMISSIONS } from './permissions';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every permission, grouped, with `available: false` for those whose module is switched off
   * for this organization (they can be added to a role but do nothing until it is switched on).
   */
  permissionCatalog(enabledModules: string[]) {
    return PERMISSIONS.map((p) => ({
      ...p,
      available: p.module === null || enabledModules.includes(p.module),
    }));
  }

  list(organizationId: string) {
    return this.prisma.forOrganization(organizationId, (db) =>
      db.role.findMany({
        where: { organizationId },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { users: true } } },
      }),
    );
  }

  get(organizationId: string, id: string) {
    return this.prisma.forOrganization(organizationId, (db) =>
      this.findRole(db, organizationId, id),
    );
  }

  create(organizationId: string, dto: CreateRoleDto, actor: CurrentUser) {
    this.checkPermissions(dto.permissions);
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
    if (dto.permissions) this.checkPermissions(dto.permissions);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findRole(db, organizationId, id);
      if (existing.isSystem)
        throw new BadRequestException('The Organization admin role cannot be changed');
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
    return this.prisma.forOrganization(organizationId, async (db) => {
      const role = await this.findRole(db, organizationId, id);
      if (role.isSystem)
        throw new BadRequestException('The Organization admin role cannot be deleted');
      if ((await db.user.count({ where: { roleId: id } })) > 0) {
        throw new BadRequestException(
          'Some users still have this role; give them another role first',
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
    const role = await db.role.findFirst({ where: { id, organizationId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  private checkPermissions(permissions: string[]) {
    const unknown = permissions.filter((p) => !isKnownPermission(p));
    if (unknown.length > 0)
      throw new BadRequestException(`Unknown permissions: ${unknown.join(', ')}`);
  }
}

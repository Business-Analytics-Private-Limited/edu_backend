/**
 * The staff users of an organization: list, add, edit, deactivate, activate.
 *
 * A user has ONE OR MORE roles (e.g. Principal AND Senior faculty) and may do everything any
 * of them allows.
 *
 * Rules:
 *   - roles must belong to this organization, and Parent / Student can't be given here (those
 *     logins come from a student's record);
 *   - nobody can hand out more than they have: you can only give roles whose permissions you
 *     have yourself, and only change users who don't have more permissions than you;
 *   - the organization must always keep at least one ACTIVE Organization admin, so it can
 *     never lock itself out.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { missingPermissions } from '../roles/permissions';
import { ORG_ADMIN } from '../roles/predefined-roles';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/user.dto';

/** User fields we read: everything except the password hash. */
const USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: { select: { id: true, name: true, permissions: true } } } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;

/** A user as the API sends it: roles as a simple list of { id, name }. */
function toPublicUser(user: UserRow) {
  const { roles, ...rest } = user;
  return { ...rest, roles: roles.map(({ role }) => ({ id: role.id, name: role.name })) };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, query: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      organizationId,
      status: query.status,
      ...(query.search && {
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };
    return this.prisma.forOrganization(organizationId, async (db) => {
      const [items, total] = await Promise.all([
        db.user.findMany({
          where,
          select: USER_FIELDS,
          orderBy: { name: 'asc' },
          ...toSkipTake(query),
        }),
        db.user.count({ where }),
      ]);
      return paginated(items.map(toPublicUser), total, query);
    });
  }

  get(organizationId: string, id: string) {
    return this.prisma.forOrganization(organizationId, async (db) =>
      toPublicUser(await this.findUser(db, organizationId, id)),
    );
  }

  create(organizationId: string, dto: CreateUserDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const roles = await this.checkRoles(db, organizationId, dto.roleIds, actor);
      const user = await db.user.create({
        data: {
          organizationId,
          name: dto.name,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          roles: { create: dto.roleIds.map((roleId) => ({ roleId, organizationId })) },
        },
        select: USER_FIELDS,
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'user',
        entityId: user.id,
        details: { name: user.name, email: user.email, roles: roles.map((r) => r.name) },
      });
      return toPublicUser(user);
    });
  }

  update(organizationId: string, id: string, dto: UpdateUserDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findUser(db, organizationId, id);
      this.checkCanChange(existing, actor);

      let roleNames: string[] | undefined;
      if (dto.roleIds) {
        const roles = await this.checkRoles(db, organizationId, dto.roleIds, actor);
        await this.keepOneAdmin(db, organizationId, { userId: id, newRoleIds: dto.roleIds });
        await db.userRole.deleteMany({ where: { userId: id } });
        await db.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({ userId: id, roleId, organizationId })),
        });
        roleNames = roles.map((r) => r.name);
      }
      const user = await db.user.update({
        where: { id },
        data: { name: dto.name },
        select: USER_FIELDS,
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'user',
        entityId: id,
        details: { name: dto.name, roles: roleNames },
      });
      return toPublicUser(user);
    });
  }

  setStatus(organizationId: string, id: string, status: UserStatus, actor: CurrentUser) {
    if (status === 'INACTIVE' && id === actor.id) {
      throw new BadRequestException('You cannot deactivate yourself');
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findUser(db, organizationId, id);
      this.checkCanChange(existing, actor);
      if (status === 'INACTIVE') await this.keepOneAdmin(db, organizationId, { userId: id });
      const user = await db.user.update({ where: { id }, data: { status }, select: USER_FIELDS });
      await this.audit.log(db, actor, {
        action: status === 'INACTIVE' ? 'deactivate' : 'activate',
        entity: 'user',
        entityId: id,
      });
      return toPublicUser(user);
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private async findUser(db: Db, organizationId: string, id: string) {
    const user = await db.user.findFirst({ where: { id, organizationId }, select: USER_FIELDS });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** The roles to give: all of this organization, assignable here, and within your permissions. */
  private async checkRoles(db: Db, organizationId: string, roleIds: string[], actor: CurrentUser) {
    const roles = await db.role.findMany({
      where: { id: { in: roleIds }, organizationId },
      include: { template: true },
    });
    if (roles.length !== roleIds.length) {
      throw new BadRequestException('Role not found in this organization');
    }
    for (const role of roles) {
      if (role.template && !role.template.assignable) {
        throw new BadRequestException(
          `The ${role.name} role is given from a student's record, not here`,
        );
      }
      if (missingPermissions(role.permissions, actor.permissions).length > 0) {
        throw new ForbiddenException(
          `You can't give the ${role.name} role: it has permissions you don't have`,
        );
      }
    }
    return roles;
  }

  /** You can't change someone who may do more than you (e.g. a Director changing an admin). */
  private checkCanChange(user: UserRow, actor: CurrentUser) {
    const theirs = user.roles.flatMap(({ role }) => role.permissions);
    if (missingPermissions(theirs, actor.permissions).length > 0) {
      throw new ForbiddenException(
        "This user has permissions you don't have, so you can't change them",
      );
    }
  }

  /**
   * Refuses a change that would leave the organization without an active Organization admin
   * (the change: deactivating `userId`, or giving them the roles `newRoleIds`).
   */
  private async keepOneAdmin(
    db: Db,
    organizationId: string,
    change: { userId: string; newRoleIds?: string[] },
  ) {
    const admins = await db.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        roles: { some: { role: { templateKey: ORG_ADMIN } } },
      },
      select: { id: true },
    });
    const othersRemain = admins.some((a) => a.id !== change.userId);
    const staysAdmin =
      change.newRoleIds !== undefined &&
      (await db.role.count({
        where: { id: { in: change.newRoleIds }, templateKey: ORG_ADMIN },
      })) > 0;
    if (!othersRemain && !staysAdmin) {
      throw new BadRequestException(
        'The organization must keep at least one active Organization admin',
      );
    }
  }
}

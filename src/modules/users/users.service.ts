/**
 * The staff users of an organization: list, add, edit, deactivate, activate.
 *
 * One rule protects the organization from locking itself out: it must always keep at least
 * one ACTIVE user whose role can manage roles ("access.role.manage").
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/user.dto';

/** User fields we send out: everything except the password hash. */
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

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
          select: PUBLIC_FIELDS,
          orderBy: { name: 'asc' },
          ...toSkipTake(query),
        }),
        db.user.count({ where }),
      ]);
      return paginated(items, total, query);
    });
  }

  get(organizationId: string, id: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const user = await db.user.findFirst({
        where: { id, organizationId },
        select: PUBLIC_FIELDS,
      });
      if (!user) throw new NotFoundException('User not found');
      return user;
    });
  }

  create(organizationId: string, dto: CreateUserDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findRole(db, organizationId, dto.roleId);
      const user = await db.user.create({
        data: {
          organizationId,
          roleId: dto.roleId,
          name: dto.name,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
        },
        select: PUBLIC_FIELDS,
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'user',
        entityId: user.id,
        details: { name: user.name, email: user.email, role: user.role.name },
      });
      return user;
    });
  }

  update(organizationId: string, id: string, dto: UpdateUserDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findUser(db, organizationId, id);
      if (dto.roleId) {
        await this.findRole(db, organizationId, dto.roleId);
        await this.keepOneRoleManager(db, organizationId, { userId: id, newRoleId: dto.roleId });
      }
      const user = await db.user.update({ where: { id }, data: dto, select: PUBLIC_FIELDS });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'user',
        entityId: id,
        details: { ...dto },
      });
      return user;
    });
  }

  setStatus(organizationId: string, id: string, status: UserStatus, actor: CurrentUser) {
    if (status === 'INACTIVE' && id === actor.id) {
      throw new BadRequestException('You cannot deactivate yourself');
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findUser(db, organizationId, id);
      if (status === 'INACTIVE') await this.keepOneRoleManager(db, organizationId, { userId: id });
      const user = await db.user.update({ where: { id }, data: { status }, select: PUBLIC_FIELDS });
      await this.audit.log(db, actor, {
        action: status === 'INACTIVE' ? 'deactivate' : 'activate',
        entity: 'user',
        entityId: id,
      });
      return user;
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  private async findUser(db: Db, organizationId: string, id: string) {
    const user = await db.user.findFirst({ where: { id, organizationId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async findRole(db: Db, organizationId: string, roleId: string) {
    const role = await db.role.findFirst({ where: { id: roleId, organizationId } });
    if (!role) throw new BadRequestException('Role not found in this organization');
    return role;
  }

  /**
   * Refuses a change that would leave the organization without any active user who can manage
   * roles (the change: deactivating `userId`, or giving them `newRoleId`).
   */
  private async keepOneRoleManager(
    db: Db,
    organizationId: string,
    change: { userId: string; newRoleId?: string },
  ) {
    const managers = await db.user.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        role: { permissions: { has: 'access.role.manage' } },
      },
      select: { id: true },
    });
    const othersRemain = managers.some((m) => m.id !== change.userId);
    const staysManager =
      change.newRoleId !== undefined &&
      (await db.role.count({
        where: { id: change.newRoleId, permissions: { has: 'access.role.manage' } },
      })) > 0;
    if (!othersRemain && !staysManager) {
      throw new BadRequestException(
        'The organization must keep at least one active user who can manage roles',
      );
    }
  }
}

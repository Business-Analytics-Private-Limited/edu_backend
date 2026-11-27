/**
 * The staff users of an organization: list, add, edit, deactivate, activate, give or take away
 * roles, and reset a forgotten password (ADR-0036).
 *
 * A user has one or more ROLES, each at a PLACE (ADR-0030): the whole organization or one
 * branch. E.g. Kiran is "Senior faculty" at KPHB and at Ameerpet; Lakshmi is "Principal" AND
 * "Branch admin" at KPHB.
 *
 * Rules:
 *   - you see the users who have a role in a place you look after ("access.user.view" there);
 *     a Branch admin sees their branch's staff, not the Organization admin;
 *   - you give a role at a place only if you have "access.user.create" / "access.user.update"
 *     there, AND every permission of that role there: nobody hands out more than they have;
 *   - you change a user's name or status, or reset their password, only if ALL their roles are
 *     within your reach;
 *   - Parent / Student can't be given here (they come from a student's record);
 *   - the Organization admin role always applies to the whole organization, and the
 *     organization must always keep at least one ACTIVE Organization admin;
 *   - a user always keeps at least one role (to block someone, deactivate them).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { can, describePlace, missingAt, Place, reachOf } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ORG_ADMIN } from '../roles/predefined-roles';
import { CreateUserDto, ListUsersQuery, RoleAssignmentDto, UpdateUserDto } from './dto/user.dto';
import { assertBranchInUse, findBranch } from '../organization/places-in-use';
import { issueTemporaryPassword } from './temporary-password';

/** User fields we read: everything except the password hash, with each role and its place. */
const USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  roles: {
    select: {
      id: true,
      branchId: true,
      role: { select: { id: true, name: true, permissions: true, templateKey: true } },
      branch: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_FIELDS }>;

/** A user as the API sends it: each role with its place (a branch, or none = everywhere). */
function toPublicUser(user: UserRow) {
  return {
    ...user,
    roles: user.roles.map((r) => ({
      id: r.id,
      role: { id: r.role.id, name: r.role.name },
      branch: r.branch,
    })),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, query: ListUsersQuery, actor: CurrentUser) {
    const where: Prisma.UserWhereInput = {
      ...this.visibleWhere(organizationId, actor),
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

  get(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) =>
      toPublicUser(await this.findVisibleUser(db, organizationId, id, actor)),
    );
  }

  create(organizationId: string, dto: CreateUserDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const assignments = [];
      for (const wanted of dto.roles) {
        assignments.push(
          await this.checkAssignment(db, organizationId, wanted, actor, 'access.user.create'),
        );
      }
      const user = await db.user.create({
        data: {
          organizationId,
          name: dto.name,
          email: dto.email.toLowerCase(),
          passwordHash: await bcrypt.hash(dto.password, 10),
          roles: {
            create: assignments.map(({ role, place }) => ({
              roleId: role.id,
              organizationId,
              branchId: place.branchId,
            })),
          },
        },
        select: USER_FIELDS,
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'user',
        entityId: user.id,
        ...onePlace(assignments.map((a) => a.place)),
        details: { name: user.name, email: user.email, roles: assignments.map((a) => a.role.name) },
      });
      return toPublicUser(user);
    });
  }

  update(organizationId: string, id: string, dto: UpdateUserDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findVisibleUser(db, organizationId, id, actor);
      this.checkCanChangeWholeUser(existing, actor);
      const user = await db.user.update({
        where: { id },
        data: { name: dto.name },
        select: USER_FIELDS,
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'user',
        entityId: id,
        ...onePlace(placesOf(existing)),
        details: { name: dto.name },
      });
      return toPublicUser(user);
    });
  }

  setStatus(organizationId: string, id: string, status: UserStatus, actor: CurrentUser) {
    if (status === 'INACTIVE' && id === actor.id) {
      throw new BadRequestException('You cannot deactivate yourself');
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findVisibleUser(db, organizationId, id, actor);
      this.checkCanChangeWholeUser(existing, actor);
      if (status === 'INACTIVE') await this.keepOneAdmin(db, organizationId, id);
      const user = await db.user.update({ where: { id }, data: { status }, select: USER_FIELDS });
      await this.audit.log(db, actor, {
        action: status === 'INACTIVE' ? 'deactivate' : 'activate',
        entity: 'user',
        entityId: id,
        ...onePlace(placesOf(existing)),
      });
      return toPublicUser(user);
    });
  }

  /**
   * Resets a staff user's password (ADR-0036): a new temporary password, shown to the admin once,
   * which the user must change at the next login. Their sessions end and a lockout is lifted.
   * Your own password you change yourself (it needs the current one).
   */
  resetPassword(organizationId: string, id: string, actor: CurrentUser) {
    if (id === actor.id) {
      throw new BadRequestException('To change your own password, use Change password');
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findVisibleUser(db, organizationId, id, actor);
      // Whoever can reset a password can log in as that person, so the same rule as for name
      // and status: all their roles must be within your reach.
      this.checkCanChangeWholeUser(existing, actor);
      const temporaryPassword = await issueTemporaryPassword(db, id);
      // Never the password itself in the log.
      await this.audit.log(db, actor, {
        action: 'reset password',
        entity: 'user',
        entityId: id,
        ...onePlace(placesOf(existing)),
        details: { user: existing.name },
      });
      return { user: { id, name: existing.name, email: existing.email }, temporaryPassword };
    });
  }

  /** Gives the user one more role at a place. */
  addRole(organizationId: string, id: string, dto: RoleAssignmentDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const user = await this.findVisibleUser(db, organizationId, id, actor);
      const { role, place } = await this.checkAssignment(
        db,
        organizationId,
        dto,
        actor,
        'access.user.update',
      );
      const duplicate = user.roles.some(
        (r) => r.role.id === role.id && r.branchId === place.branchId,
      );
      if (duplicate) throw new ConflictException(`${user.name} already has this role here`);

      await db.userRole.create({
        data: {
          userId: id,
          roleId: role.id,
          organizationId,
          branchId: place.branchId,
        },
      });
      await this.audit.log(db, actor, {
        action: 'add role',
        entity: 'user',
        entityId: id,
        ...place,
        details: { user: user.name, role: role.name },
      });
      return toPublicUser(await this.findVisibleUser(db, organizationId, id, actor));
    });
  }

  /** Takes one role (at one place) away from the user. */
  removeRole(organizationId: string, id: string, assignmentId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const user = await this.findVisibleUser(db, organizationId, id, actor);
      const assignment = user.roles.find((r) => r.id === assignmentId);
      if (!assignment) throw new NotFoundException('This user does not have that role');
      const place = { branchId: assignment.branchId };

      if (
        !can(actor, 'access.user.update', place) ||
        missingAt(actor, assignment.role.permissions, place).length > 0
      ) {
        throw new ForbiddenException(
          `You can't take away the ${assignment.role.name} role for ${describePlace(place)}`,
        );
      }
      if (user.roles.length === 1) {
        throw new BadRequestException(
          'A user needs at least one role; to block them, deactivate them instead',
        );
      }
      if (assignment.role.templateKey === ORG_ADMIN) {
        await this.keepOneAdmin(db, organizationId, id);
      }

      await db.userRole.delete({ where: { id: assignmentId } });
      await this.audit.log(db, actor, {
        action: 'remove role',
        entity: 'user',
        entityId: id,
        ...place,
        details: { user: user.name, role: assignment.role.name },
      });
      // Read without the reach filter: after this change the user may no longer be the
      // actor's staff (e.g. their only role at the actor's branch was just taken away).
      const updated = await db.user.findFirstOrThrow({
        where: { id, organizationId },
        select: USER_FIELDS,
      });
      return toPublicUser(updated);
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  /** Users with at least one role in a place where the actor may see users. */
  private visibleWhere(organizationId: string, actor: CurrentUser): Prisma.UserWhereInput {
    const reach = reachOf(actor, 'access.user.view');
    // Parent / student logins are managed from the student's page, not here.
    if (reach.everywhere) return { organizationId, kind: 'STAFF' };
    return {
      organizationId,
      kind: 'STAFF',
      roles: { some: { branchId: { in: reach.branchIds } } },
    };
  }

  /** The user, or 404 if they don't exist or the actor may not see them. */
  private async findVisibleUser(db: Db, organizationId: string, id: string, actor: CurrentUser) {
    const user = await db.user.findFirst({
      where: { ...this.visibleWhere(organizationId, actor), id },
      select: USER_FIELDS,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Checks one role to give: it belongs to this organization, may be given here, fits its
   * place, and the actor may give it there. Returns the role and the full place.
   */
  private async checkAssignment(
    db: Db,
    organizationId: string,
    wanted: RoleAssignmentDto,
    actor: CurrentUser,
    permission: 'access.user.create' | 'access.user.update',
  ) {
    const role = await db.role.findFirst({
      where: { id: wanted.roleId, organizationId },
      include: { template: true },
    });
    if (!role) throw new BadRequestException('Role not found in this organization');
    if (role.template && !role.template.assignable) {
      throw new BadRequestException(
        `The ${role.name} role is given from a student's record, not here`,
      );
    }

    const place = await this.resolvePlace(db, organizationId, wanted);
    if (role.templateKey === ORG_ADMIN && place.branchId) {
      throw new BadRequestException(
        'The Organization admin role always applies to the whole organization',
      );
    }
    if (!can(actor, permission, place)) {
      throw new ForbiddenException(`You can't add staff to ${describePlace(place)}`);
    }
    if (missingAt(actor, role.permissions, place).length > 0) {
      throw new ForbiddenException(
        `You can't give the ${role.name} role for ${describePlace(place)}: it has permissions you don't have there`,
      );
    }
    return { role, place };
  }

  /** Turns { branchId? } into a checked place of this organization. */
  private async resolvePlace(
    db: Db,
    organizationId: string,
    wanted: { branchId?: string },
  ): Promise<{ branchId: string | null }> {
    if (!wanted.branchId) return { branchId: null };
    const branch = await findBranch(db, organizationId, wanted.branchId);
    await assertBranchInUse(db, branch.id);
    return { branchId: branch.id };
  }

  /**
   * Name and status affect the user everywhere, so the actor must look after ALL their places
   * and have every permission of each of their roles there.
   */
  private checkCanChangeWholeUser(user: UserRow, actor: CurrentUser) {
    for (const r of user.roles) {
      const place = { branchId: r.branchId };
      if (
        !can(actor, 'access.user.update', place) ||
        missingAt(actor, r.role.permissions, place).length > 0
      ) {
        throw new ForbiddenException(
          "This user has roles outside your reach or permissions you don't have, so you can't change them",
        );
      }
    }
  }

  /** Refuses a change that would leave the organization without an active Organization admin. */
  private async keepOneAdmin(db: Db, organizationId: string, losingUserId: string) {
    const others = await db.user.count({
      where: {
        organizationId,
        id: { not: losingUserId },
        status: 'ACTIVE',
        roles: { some: { role: { templateKey: ORG_ADMIN } } },
      },
    });
    if (others === 0) {
      throw new BadRequestException(
        'The organization must keep at least one active Organization admin',
      );
    }
  }
}

/** Every place a user has a role. */
function placesOf(user: UserRow): Place[] {
  return user.roles.map((r) => ({ branchId: r.branchId }));
}

/**
 * For the audit log: the branch, if all of them are the same one; otherwise the organization
 * (then only organization-wide admins see the entry).
 */
function onePlace(places: Place[]): { branchId: string | null } {
  const [first] = places;
  const same = places.every((p) => (p.branchId ?? null) === (first?.branchId ?? null));
  return { branchId: same && first ? (first.branchId ?? null) : null };
}

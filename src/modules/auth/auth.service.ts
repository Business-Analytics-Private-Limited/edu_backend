/**
 * Login and passwords.
 *
 * Login checks the email and password, then returns a signed token (JWT). The frontend sends
 * it back on every request as "Authorization: Bearer <token>". The token only says who the
 * person is; what they may do is checked on each request (JwtStrategy + AccessGuard).
 *
 * Every login attempt (also failed ones) and every password change is written to the audit log
 * (ADR-0027). A failed attempt is saved on its own, before the error is returned.
 */
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser, JwtPayload } from '../../common/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditActor, AuditService } from '../audit/audit.service';

/** The same message for "no such email" and "wrong password", so nobody can probe for emails. */
const WRONG_LOGIN = 'Email or password is wrong';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  /** Login for EduPlatform staff (the super admin console). */
  async superAdminLogin(email: string, password: string) {
    const admin = await this.prisma.superAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    const actor: AuditActor = admin
      ? { type: 'super_admin', id: admin.id, name: admin.name, organizationId: null }
      : { type: 'unknown', id: null, name: null, organizationId: null };
    const failure = !admin
      ? 'unknown email'
      : !admin.isActive
        ? 'account not active'
        : !(await bcrypt.compare(password, admin.passwordHash))
          ? 'wrong password'
          : null;
    await this.recordLogin(actor, 'super_admin', email, failure);
    if (failure || !admin) throw new UnauthorizedException(WRONG_LOGIN);
    return {
      accessToken: this.createToken({ sub: admin.id, type: 'super_admin' }),
      user: { id: admin.id, name: admin.name, email: admin.email, type: 'super_admin' as const },
    };
  }

  /** Login for users of an organization (the institution web app). */
  async userLogin(email: string, password: string) {
    // Nobody is logged in yet, so this lookup can't be limited to one organization.
    const user = await this.prisma.forAllOrganizations((db) =>
      db.user.findUnique({
        where: { email: email.toLowerCase() },
        include: { organization: true, roles: { include: { role: true } } },
      }),
    );
    const actor: AuditActor = user
      ? { type: 'user', id: user.id, name: user.name, organizationId: user.organizationId }
      : { type: 'unknown', id: null, name: null, organizationId: null };
    const failure = !user
      ? 'unknown email'
      : !(await bcrypt.compare(password, user.passwordHash))
        ? 'wrong password'
        : user.status !== 'ACTIVE'
          ? 'account deactivated'
          : user.organization.status !== 'ACTIVE'
            ? 'organization suspended'
            : null;
    await this.recordLogin(actor, 'user', email, failure);
    if (!user || failure === 'wrong password' || failure === 'unknown email') {
      throw new UnauthorizedException(WRONG_LOGIN);
    }
    if (failure === 'account deactivated') {
      throw new UnauthorizedException('Your account is deactivated');
    }
    if (failure) throw new UnauthorizedException('Your organization is suspended');

    await this.prisma.forOrganization(user.organizationId, (db) =>
      db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );
    return {
      accessToken: this.createToken({ sub: user.id, type: 'user' }),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: 'user' as const,
        kind: user.kind.toLowerCase(),
        organization: { id: user.organization.id, name: user.organization.name },
        roleNames: [...new Set(user.roles.map((r) => r.role.name))],
      },
    };
  }

  /** Changes the logged-in person's own password. */
  async changePassword(user: CurrentUser, currentPassword: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);

    if (user.type === 'super_admin') {
      await this.prisma.forAllOrganizations(async (db) => {
        const admin = await db.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
        await this.checkCurrentPassword(currentPassword, admin.passwordHash);
        await db.superAdmin.update({ where: { id: user.id }, data: { passwordHash } });
        await this.audit.log(db, user, {
          action: 'change password',
          entity: 'super_admin',
          entityId: user.id,
          organizationId: null,
        });
      });
      return { changed: true };
    }

    await this.prisma.forOrganization(user.organizationId!, async (db) => {
      const found = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      await this.checkCurrentPassword(currentPassword, found.passwordHash);
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.audit.log(db, user, {
        action: 'change password',
        entity: 'user',
        entityId: user.id,
      });
    });
    return { changed: true };
  }

  /**
   * One audit entry per login attempt: "login" or "login failed" with the reason. Saved in its
   * own transaction, so a failed attempt stays recorded although the request ends in an error.
   * Never the password.
   */
  private recordLogin(
    actor: AuditActor,
    entity: 'super_admin' | 'user',
    email: string,
    failure: string | null,
  ) {
    return this.prisma.forAllOrganizations((db) =>
      this.audit.log(db, actor, {
        action: failure ? 'login failed' : 'login',
        entity,
        entityId: actor.id ?? undefined,
        organizationId: actor.organizationId,
        details: failure ? { email: email.toLowerCase(), reason: failure } : undefined,
      }),
    );
  }

  private async checkCurrentPassword(given: string, hash: string) {
    if (!(await bcrypt.compare(given, hash))) {
      throw new BadRequestException('The current password is wrong');
    }
  }

  private createToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }
}

/**
 * Login, logout and passwords.
 *
 * Login checks the email and password (and, for a super admin with two-step login, the 6-digit
 * code), starts a SESSION and returns a signed token (JWT) that carries the session's id. The
 * frontend sends it back on every request as "Authorization: Bearer <token>"; JwtStrategy only
 * accepts it while the session hasn't ended (ADR-0028). What the person may do is checked on each
 * request (JwtStrategy + AccessGuard).
 *
 * Protection against password guessing (ADR-0028):
 *   - 5 failed logins in a row lock the account for 15 minutes (also with the right password);
 *   - "no such email" and "wrong password" give the same answer in the same time;
 *   - at most 10 login requests per minute from one address (auth.controller.ts).
 *
 * A temporary password (set by an admin or the seed) must be changed at the next login: until
 * then AccessGuard only allows "who am I", changing the password and logging out.
 *
 * Every attempt (also failed ones), logout and password change is written to the audit log
 * (ADR-0027). A failed attempt is saved on its own, before the error is returned.
 */
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import type { CurrentUser, JwtPayload } from '../../common/current-user';
import { open } from '../../common/secret-box';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditActor, AuditService } from '../audit/audit.service';
import type { LoginDto } from './dto/login.dto';

/** The same message for "no such email" and "wrong password", so nobody can probe for emails. */
const WRONG_LOGIN = 'Email or password is wrong';
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** Compared when the email is unknown, so that answer takes as long as a wrong password. */
const DUMMY_HASH = bcrypt.hashSync('no-such-account-placeholder', 10);

/** The account a login is for: a super admin or an organization user. */
interface Account {
  entity: 'super_admin' | 'user';
  id: string;
  name: string;
  organizationId: string | null;
  failedLogins: number;
  lockedUntil: Date | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** Login for EduPlatform staff (the super admin console). */
  async superAdminLogin(dto: LoginDto, ip: string | null) {
    const email = dto.email.toLowerCase();
    const admin = await this.prisma.superAdmin.findUnique({ where: { email } });
    const passwordOk = await bcrypt.compare(dto.password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin) return this.refuse(null, 'super_admin', email, ip, 'unknown email');

    const account: Account = { entity: 'super_admin', organizationId: null, ...admin };
    await this.checkNotLocked(account, email, ip);
    if (!passwordOk) return this.failedAttempt(account, email, ip, 'wrong password');
    if (!admin.isActive)
      return this.refuse(account, 'super_admin', email, ip, 'account not active');

    if (admin.totpEnabled && admin.totpSecret) {
      // The password was right: ask for the code (not a failed attempt).
      if (!dto.code) {
        throw new UnauthorizedException({
          statusCode: 401,
          message: 'Enter the 6-digit code from your authenticator app',
          twoFactorRequired: true,
        });
      }
      if (!authenticator.check(dto.code, open(admin.totpSecret))) {
        return this.failedAttempt(account, email, ip, 'wrong two-step code');
      }
    }

    await this.succeeded(account, ip);
    return {
      accessToken: await this.startSession(account, ip),
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        type: 'super_admin' as const,
        mustChangePassword: admin.mustChangePassword,
      },
    };
  }

  /** Login for users of an organization (the institution web app and the portal). */
  async userLogin(dto: LoginDto, ip: string | null) {
    const email = dto.email.toLowerCase();
    // Nobody is logged in yet, so this lookup can't be limited to one organization.
    const user = await this.prisma.forAllOrganizations((db) =>
      db.user.findUnique({
        where: { email },
        include: { organization: true, roles: { include: { role: true } } },
      }),
    );
    const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user) return this.refuse(null, 'user', email, ip, 'unknown email');

    const account: Account = { entity: 'user', ...user };
    await this.checkNotLocked(account, email, ip);
    if (!passwordOk) return this.failedAttempt(account, email, ip, 'wrong password');
    if (user.status !== 'ACTIVE') {
      return this.refuse(
        account,
        'user',
        email,
        ip,
        'account deactivated',
        'Your account is deactivated',
      );
    }
    if (user.organization.status !== 'ACTIVE') {
      return this.refuse(
        account,
        'user',
        email,
        ip,
        'organization suspended',
        'Your organization is suspended',
      );
    }

    await this.succeeded(account, ip);
    return {
      accessToken: await this.startSession(account, ip),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        type: 'user' as const,
        kind: user.kind.toLowerCase(),
        organization: { id: user.organization.id, name: user.organization.name },
        roleNames: [...new Set(user.roles.map((r) => r.role.name))],
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /** Ends this session: its token stops working at once. */
  async logout(user: CurrentUser) {
    await this.prisma.forAllOrganizations(async (db) => {
      await db.loginSession.update({
        where: { id: user.sessionId! },
        data: { endedAt: new Date() },
      });
      await this.audit.log(db, user, {
        action: 'logout',
        entity: user.type === 'super_admin' ? 'super_admin' : 'user',
        entityId: user.id,
        organizationId: user.organizationId,
      });
    });
    return { loggedOut: true };
  }

  /**
   * Changes the logged-in person's own password. Ends their OTHER sessions (e.g. on a lost
   * phone); this one goes on. A temporary password counts as changed from now on.
   */
  async changePassword(user: CurrentUser, currentPassword: string, newPassword: string) {
    if (currentPassword === newPassword) {
      throw new BadRequestException('The new password must be different from the current one');
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const data = { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null };
    const otherSessions = { id: { not: user.sessionId! }, endedAt: null };

    await this.prisma.forAllOrganizations(async (db) => {
      if (user.type === 'super_admin') {
        const admin = await db.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
        await this.checkCurrentPassword(currentPassword, admin.passwordHash);
        await db.superAdmin.update({ where: { id: user.id }, data });
        await db.loginSession.updateMany({
          where: { superAdminId: user.id, ...otherSessions },
          data: { endedAt: new Date() },
        });
      } else {
        const found = await db.user.findUniqueOrThrow({ where: { id: user.id } });
        await this.checkCurrentPassword(currentPassword, found.passwordHash);
        await db.user.update({ where: { id: user.id }, data });
        await db.loginSession.updateMany({
          where: { userId: user.id, ...otherSessions },
          data: { endedAt: new Date() },
        });
      }
      await this.audit.log(db, user, {
        action: 'change password',
        entity: user.type === 'super_admin' ? 'super_admin' : 'user',
        entityId: user.id,
        organizationId: user.organizationId,
      });
    });
    return { changed: true };
  }

  // --- Helpers ---------------------------------------------------------------------------------

  /** A locked account is refused even with the right password, until the lock runs out. */
  private async checkNotLocked(account: Account, email: string, ip: string | null) {
    if (account.lockedUntil && account.lockedUntil > new Date()) {
      const minutes = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 60_000);
      await this.refuse(
        account,
        account.entity,
        email,
        ip,
        'account locked',
        `Too many failed logins. Try again in ${minutes} minute(s).`,
      );
    }
  }

  /** Counts a wrong password or code; the 5th in a row locks the account for 15 minutes. */
  private async failedAttempt(
    account: Account,
    email: string,
    ip: string | null,
    reason: string,
  ): Promise<never> {
    const failedLogins = account.failedLogins + 1;
    const lock = failedLogins >= MAX_FAILED_LOGINS;
    await this.updateAccount(
      account,
      lock
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
        : { failedLogins },
    );
    return this.refuse(
      account,
      account.entity,
      email,
      ip,
      lock ? `${reason}; account locked for ${LOCK_MINUTES} minutes` : reason,
      lock ? `Too many failed logins. Try again in ${LOCK_MINUTES} minute(s).` : WRONG_LOGIN,
    );
  }

  /** Records the failed attempt, then answers 401 with the message. */
  private async refuse(
    account: Account | null,
    entity: 'super_admin' | 'user',
    email: string,
    ip: string | null,
    reason: string,
    message = WRONG_LOGIN,
  ): Promise<never> {
    await this.recordLogin(account, entity, email, ip, reason);
    throw new UnauthorizedException(message);
  }

  private async succeeded(account: Account, ip: string | null) {
    await this.updateAccount(account, {
      failedLogins: 0,
      lockedUntil: null,
      ...(account.entity === 'user' ? { lastLoginAt: new Date() } : {}),
    });
    await this.recordLogin(account, account.entity, null, ip, null);
  }

  private updateAccount(
    account: Account,
    data: { failedLogins?: number; lockedUntil?: Date | null; lastLoginAt?: Date },
  ) {
    return this.prisma.forAllOrganizations(async (db) => {
      if (account.entity === 'super_admin') {
        // super_admins has no last_login_at column; only the counters apply.
        await db.superAdmin.update({
          where: { id: account.id },
          data: { failedLogins: data.failedLogins, lockedUntil: data.lockedUntil },
        });
      } else {
        await db.user.update({ where: { id: account.id }, data });
      }
    });
  }

  /** A new session, and the token that carries its id. Both end at the same time. */
  private async startSession(account: Account, ip: string | null): Promise<string> {
    const sessionId = randomUUID();
    const payload: JwtPayload = {
      sub: account.id,
      type: account.entity === 'super_admin' ? 'super_admin' : 'user',
      sid: sessionId,
    };
    const token = this.jwt.sign(payload, {
      expiresIn: this.config.get('JWT_EXPIRES_IN', '8h'),
    });
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    await this.prisma.forAllOrganizations((db) =>
      db.loginSession.create({
        data: {
          id: sessionId,
          ip,
          expiresAt: new Date(exp * 1000),
          ...(account.entity === 'super_admin'
            ? { superAdminId: account.id }
            : { userId: account.id }),
        },
      }),
    );
    return token;
  }

  /**
   * One audit entry per login attempt: "login" or "login failed" with the reason and the address
   * it came from. Saved in its own transaction, so a failed attempt stays recorded although the
   * request ends in an error. Never the password.
   */
  private recordLogin(
    account: Account | null,
    entity: 'super_admin' | 'user',
    email: string | null,
    ip: string | null,
    failure: string | null,
  ) {
    const actor: AuditActor = account
      ? {
          type: account.entity,
          id: account.id,
          name: account.name,
          organizationId: account.organizationId,
        }
      : { type: 'unknown', id: null, name: null, organizationId: null };
    return this.prisma.forAllOrganizations((db) =>
      this.audit.log(db, actor, {
        action: failure ? 'login failed' : 'login',
        entity,
        entityId: actor.id ?? undefined,
        organizationId: actor.organizationId,
        details: failure ? { email, reason: failure, ip } : { ip },
      }),
    );
  }

  private async checkCurrentPassword(given: string, hash: string) {
    if (!(await bcrypt.compare(given, hash))) {
      throw new BadRequestException('The current password is wrong');
    }
  }
}

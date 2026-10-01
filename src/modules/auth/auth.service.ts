/**
 * Login and passwords.
 *
 * Login checks the email and password, then returns a signed token (JWT). The frontend sends
 * it back on every request as "Authorization: Bearer <token>". The token only says who the
 * person is; what they may do is checked on each request (JwtStrategy + AccessGuard).
 */
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { CurrentUser, JwtPayload } from '../../common/current-user';
import { PrismaService } from '../../prisma/prisma.service';

/** The same message for "no such email" and "wrong password", so nobody can probe for emails. */
const WRONG_LOGIN = 'Email or password is wrong';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Login for EduPlatform staff (the super admin console). */
  async superAdminLogin(email: string, password: string) {
    const admin = await this.prisma.superAdmin.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!admin || !admin.isActive || !(await bcrypt.compare(password, admin.passwordHash))) {
      throw new UnauthorizedException(WRONG_LOGIN);
    }
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
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException(WRONG_LOGIN);
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Your account is deactivated');
    if (user.organization.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your organization is suspended');
    }

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
      const admin = await this.prisma.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
      await this.checkCurrentPassword(currentPassword, admin.passwordHash);
      await this.prisma.superAdmin.update({ where: { id: user.id }, data: { passwordHash } });
      return { changed: true };
    }

    await this.prisma.forOrganization(user.organizationId!, async (db) => {
      const found = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      await this.checkCurrentPassword(currentPassword, found.passwordHash);
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    });
    return { changed: true };
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

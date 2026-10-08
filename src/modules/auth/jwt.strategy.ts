/**
 * Checks the login token on every request and finds who it belongs to.
 *
 * 1. passport-jwt checks the token's signature (JWT_SECRET) and expiry.
 * 2. validate() checks that the token's login session hasn't ended (logout, password change;
 *    ADR-0028), then loads the person from the database, so a deactivated user, a suspended
 *    organization or changed roles take effect at once, not only when the token expires.
 * 3. What validate() returns becomes request.user (the CurrentUser).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { CurrentUser, JwtPayload } from '../../common/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { ORG_ADMIN } from '../roles/predefined-roles';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<CurrentUser> {
    await this.checkSession(payload);
    if (payload.type === 'super_admin') {
      const admin = await this.prisma.superAdmin.findUnique({ where: { id: payload.sub } });
      if (!admin || !admin.isActive) throw new UnauthorizedException('Account is not active');
      return {
        type: 'super_admin',
        id: admin.id,
        name: admin.name,
        email: admin.email,
        sessionId: payload.sid,
        mustChangePassword: admin.mustChangePassword,
        twoFactor: admin.totpEnabled ? 'on' : admin.totpSecret ? 'pending' : 'off',
        organizationId: null,
        kind: null,
        studentIds: [],
        roleNames: [],
        permissions: [],
        grants: [],
        isOrganizationAdmin: false,
        enabledModules: [],
      };
    }

    // An organization user: load the user, their roles and their organization's modules.
    const user = await this.prisma.forAllOrganizations((db) =>
      db.user.findUnique({
        where: { id: payload.sub },
        include: {
          roles: {
            include: {
              role: true,
              branch: { select: { status: true } },
            },
          },
          organization: { include: { modules: { where: { enabled: true } } } },
          guardian: { include: { students: { select: { studentId: true } } } },
        },
      }),
    );
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    if (user.organization.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your organization is suspended');
    }
    const enabledModules = user.organization.modules.map((m) => m.moduleKey);
    if (user.kind !== 'STAFF') {
      // A portal login: no roles, no permissions; only the linked students.
      return {
        type: 'user',
        id: user.id,
        name: user.name,
        email: user.email,
        sessionId: payload.sid,
        mustChangePassword: user.mustChangePassword,
        twoFactor: null,
        organizationId: user.organizationId,
        kind: user.kind === 'PARENT' ? 'parent' : 'student',
        studentIds:
          user.kind === 'PARENT'
            ? (user.guardian?.students.map((s) => s.studentId) ?? [])
            : [user.studentId!],
        roleNames: [],
        permissions: [],
        grants: [],
        isOrganizationAdmin: false,
        enabledModules,
      };
    }
    // Roles at an inactive branch give no access (ADR-0026).
    const roles = user.roles.filter((r) => r.branch?.status !== 'INACTIVE');
    return {
      type: 'user',
      id: user.id,
      name: user.name,
      email: user.email,
      sessionId: payload.sid,
      mustChangePassword: user.mustChangePassword,
      twoFactor: null,
      organizationId: user.organizationId,
      kind: 'staff',
      studentIds: [],
      roleNames: [...new Set(roles.map((r) => r.role.name))],
      // A user with several roles may do everything any of them allows (each in its own place).
      permissions: [...new Set(roles.flatMap((r) => r.role.permissions))],
      grants: roles.map((r) => ({
        roleName: r.role.name,
        permissions: r.role.permissions,
        branchId: r.branchId,
      })),
      isOrganizationAdmin: roles.some((r) => r.role.templateKey === ORG_ADMIN && !r.branchId),
      enabledModules,
    };
  }

  /** The token's session must exist, belong to this person, and not have ended or expired. */
  private async checkSession(payload: JwtPayload) {
    const session = payload.sid
      ? await this.prisma.loginSession.findUnique({ where: { id: payload.sid } })
      : null;
    const owner = payload.type === 'super_admin' ? session?.superAdminId : session?.userId;
    if (!session || owner !== payload.sub || session.endedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Your session has ended; please log in again');
    }
  }
}

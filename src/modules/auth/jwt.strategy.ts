/**
 * Checks the login token on every request and finds who it belongs to.
 *
 * 1. passport-jwt checks the token's signature (JWT_SECRET) and expiry.
 * 2. validate() loads the person from the database, so a deactivated user, a suspended
 *    organization or changed roles take effect at once, not only when the token expires.
 * 3. What validate() returns becomes request.user (the CurrentUser).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { CurrentUser, JwtPayload } from '../../common/current-user';
import { PrismaService } from '../../prisma/prisma.service';

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
    if (payload.type === 'super_admin') {
      const admin = await this.prisma.superAdmin.findUnique({ where: { id: payload.sub } });
      if (!admin || !admin.isActive) throw new UnauthorizedException('Account is not active');
      return {
        type: 'super_admin',
        id: admin.id,
        name: admin.name,
        email: admin.email,
        organizationId: null,
        roleNames: [],
        permissions: [],
        grants: [],
        enabledModules: [],
      };
    }

    // An organization user: load the user, their roles and their organization's modules.
    const user = await this.prisma.forAllOrganizations((db) =>
      db.user.findUnique({
        where: { id: payload.sub },
        include: {
          roles: { include: { role: true } },
          organization: { include: { modules: { where: { enabled: true } } } },
        },
      }),
    );
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    if (user.organization.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your organization is suspended');
    }
    return {
      type: 'user',
      id: user.id,
      name: user.name,
      email: user.email,
      organizationId: user.organizationId,
      roleNames: [...new Set(user.roles.map((r) => r.role.name))],
      // A user with several roles may do everything any of them allows (each in its own place).
      permissions: [...new Set(user.roles.flatMap((r) => r.role.permissions))],
      grants: user.roles.map((r) => ({
        roleName: r.role.name,
        permissions: r.role.permissions,
        institutionId: r.institutionId,
        campusId: r.campusId,
      })),
      enabledModules: user.organization.modules.map((m) => m.moduleKey),
    };
  }
}

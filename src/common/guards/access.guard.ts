/**
 * STEP 2 of every request: is this person ALLOWED to call this endpoint?
 * Runs after JwtAuthGuard, so request.user is already known. Reads the access decorator of the
 * endpoint (src/common/decorators/access.decorators.ts) and answers yes or 403.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { moduleOfPermission } from '../../modules/roles/permissions';
import type { CurrentUser } from '../current-user';
import { ACCESS_RULE, AccessRule } from '../decorators/access.decorators';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<AccessRule>(ACCESS_RULE, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Safety first: an endpoint that forgot to say who may call it is closed to everyone.
    if (!rule) throw new ForbiddenException('This endpoint has no access rule');
    if (rule.kind === 'public') return true;

    const user: CurrentUser = context.switchToHttp().getRequest().user;

    // A temporary password must be changed before anything else (ADR-0028). "Logged in" routes
    // (who am I, change password, log out) stay open.
    if (user.mustChangePassword && rule.kind !== 'logged_in') {
      throw new ForbiddenException('Change your temporary password first');
    }

    switch (rule.kind) {
      case 'logged_in':
        return true;

      case 'super_admin':
        if (user.type !== 'super_admin') throw new ForbiddenException('Super admins only');
        return true;

      case 'organization_user':
        if (user.type !== 'user' || user.kind !== 'staff') {
          throw new ForbiddenException('Organization staff only');
        }
        return true;

      case 'portal':
        if (user.type !== 'user' || user.kind === 'staff') {
          throw new ForbiddenException('Parent and student logins only');
        }
        if (!user.enabledModules.includes('portal')) {
          throw new ForbiddenException('The parent and student portal is not switched on');
        }
        return true;

      case 'permission': {
        // Portal users have no permissions, so they never get past this.
        if (user.type !== 'user' || user.kind !== 'staff') {
          throw new ForbiddenException('Organization staff only');
        }
        if (!user.permissions.includes(rule.permission)) {
          throw new ForbiddenException(`Your role needs the permission "${rule.permission}"`);
        }
        const module = moduleOfPermission(rule.permission);
        if (module && !user.enabledModules.includes(module)) {
          throw new ForbiddenException(
            `The ${module} module is not switched on for your organization`,
          );
        }
        return true;
      }
    }
  }
}

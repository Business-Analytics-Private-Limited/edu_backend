/**
 * The global access guard: runs before every endpoint and decides whether the request may
 * continue. The order of checks (docs/04-roles-and-permissions.md §4.1):
 *
 *   @Public()                         → allowed, no login needed
 *   no token / bad token / unknown user → 401 unauthenticated
 *   wrong kind of user                → 403 (platform staff on tenant endpoints, or the reverse)
 *   @AuthenticatedOnly()              → allowed
 *   no declaration                    → 403 (deny by default)
 *   module not enabled                → 403 module_not_enabled      (check 1)
 *   permission missing                → 403 permission_denied       (check 3)
 *
 * Check 4 (is the record inside the user's scope?) needs the record itself, so the service
 * does it and answers 404 when it fails.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AUTHENTICATOR, type Authenticator } from '../auth/authenticator';
import { updateContext } from '../context/request-context';
import {
  ModuleNotEnabledError,
  PermissionDeniedError,
  UnauthenticatedError,
} from '../errors/problem';
import { isAccessDeclared, readAccessDeclaration } from './decorators';

/**
 * Answers checks 1–3 of doc 4 §4.1 for the current user. Implemented by the platform and
 * access services in Phase 2; until then every check is denied.
 * Check 4 (scope) needs the target record, so services apply it, not the guard.
 */
export interface AuthorizationPort {
  isModuleEnabled(moduleKey: string): Promise<boolean>;
  hasPermission(permission: string): Promise<boolean>;
}

export const AUTHORIZATION_PORT = Symbol('AUTHORIZATION_PORT');

export class DenyAllAuthorization implements AuthorizationPort {
  async isModuleEnabled(): Promise<boolean> {
    return false;
  }
  async hasPermission(): Promise<boolean> {
    return false;
  }
}

/** Global guard. Deny by default: an endpoint without an access declaration is refused. */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(AUTHENTICATOR) private readonly authenticator: Authenticator,
    @Inject(AUTHORIZATION_PORT) private readonly authorization: AuthorizationPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const declaration = readAccessDeclaration(context.getHandler(), context.getClass());
    if (declaration.mode === 'public') return true;

    // 1. Who is calling? (token checked, person looked up in our records)
    const header = context.switchToHttp().getRequest<IncomingMessage>().headers.authorization;
    const identity = await this.authenticator.authenticate(header);
    if (!identity) throw new UnauthenticatedError();
    // From here on, the database layer, audit writer and logger know the tenant and user.
    updateContext(identity);

    // 2. Is this the right kind of user for this endpoint?
    if (declaration.platform && identity.actorType !== 'platform_user') {
      throw new PermissionDeniedError('This endpoint is for platform staff only');
    }
    if (!declaration.platform && identity.actorType !== 'user') {
      throw new PermissionDeniedError(
        'Platform staff use the /admin endpoints; to act inside a tenant, start impersonation',
      );
    }
    if (declaration.mode === 'authenticated') return true;

    // 3. Module and permission (deny by default).
    if (!isAccessDeclared(declaration)) {
      throw new PermissionDeniedError('This endpoint has no access declaration');
    }
    if (!(await this.authorization.isModuleEnabled(declaration.moduleKey!))) {
      throw new ModuleNotEnabledError(declaration.moduleKey!);
    }
    if (!(await this.authorization.hasPermission(declaration.permission!))) {
      throw new PermissionDeniedError();
    }
    return true;
  }
}

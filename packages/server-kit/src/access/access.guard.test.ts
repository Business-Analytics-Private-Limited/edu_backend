/**
 * The global access guard, with a fake authenticator and fake permission answers.
 */
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedIdentity, Authenticator } from '../auth/authenticator';
import { currentContext, runWithContext } from '../context/request-context';
import { ProblemError, UnauthenticatedError } from '../errors/problem';
import { AccessGuard, DenyAllAuthorization, type AuthorizationPort } from './access.guard';
import {
  AuthenticatedOnly,
  PlatformEndpoint,
  Public,
  RequireModule,
  RequirePermission,
} from './decorators';

class TenantController {
  @Public()
  health(): void {}

  @AuthenticatedOnly()
  me(): void {}

  @RequireModule('students')
  @RequirePermission('students.student.view')
  list(): void {}

  undeclared(): void {}
}

@PlatformEndpoint()
class AdminController {
  @RequireModule('platform')
  @RequirePermission('admin.tenant.view')
  tenants(): void {}
}

function executionContext(
  controller: typeof TenantController | typeof AdminController,
  handler: string,
  authorization = 'Bearer token',
): ExecutionContext {
  return {
    getHandler: () => (controller.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

const tenantUser: AuthenticatedIdentity = {
  actorType: 'user',
  userId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e90',
  tenantId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e8f',
};
const platformUser: AuthenticatedIdentity = {
  actorType: 'platform_user',
  userId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e91',
};

/** An authenticator that returns a fixed identity (or none, or fails). */
const authenticatesAs = (identity: AuthenticatedIdentity | null | 'invalid'): Authenticator => ({
  authenticate: async () => {
    if (identity === 'invalid') throw new UnauthenticatedError('The token is not valid');
    return identity;
  },
});

const allowAll: AuthorizationPort = {
  isModuleEnabled: async () => true,
  hasPermission: async () => true,
};

/** Runs the guard inside a fresh request context; returns 'allowed' or the error code. */
async function check(
  guard: AccessGuard,
  controller: typeof TenantController | typeof AdminController,
  handler: string,
): Promise<string> {
  try {
    await runWithContext({ requestId: 'req-00000001', actorType: 'user' }, () =>
      guard.canActivate(executionContext(controller, handler)),
    );
    return 'allowed';
  } catch (error) {
    if (error instanceof ProblemError) return error.code;
    throw error;
  }
}

describe('AccessGuard', () => {
  it('lets anyone reach a public endpoint, without looking at tokens', async () => {
    const guard = new AccessGuard(authenticatesAs('invalid'), new DenyAllAuthorization());
    expect(await check(guard, TenantController, 'health')).toBe('allowed');
  });

  it('requires a login for everything else', async () => {
    const guard = new AccessGuard(authenticatesAs(null), allowAll);
    expect(await check(guard, TenantController, 'me')).toBe('unauthenticated');
  });

  it('refuses an invalid token', async () => {
    const guard = new AccessGuard(authenticatesAs('invalid'), allowAll);
    expect(await check(guard, TenantController, 'list')).toBe('unauthenticated');
  });

  it('lets any signed-in tenant user reach an authenticated-only endpoint', async () => {
    const guard = new AccessGuard(authenticatesAs(tenantUser), new DenyAllAuthorization());
    expect(await check(guard, TenantController, 'me')).toBe('allowed');
  });

  it('stores the identity in the request context', async () => {
    const guard = new AccessGuard(authenticatesAs(tenantUser), allowAll);
    const seen = await runWithContext(
      { requestId: 'req-00000002', actorType: 'user' },
      async () => {
        await guard.canActivate(executionContext(TenantController, 'list'));
        return currentContext();
      },
    );
    expect(seen).toMatchObject(tenantUser);
  });

  it('refuses a module the tenant is not entitled to', async () => {
    const guard = new AccessGuard(authenticatesAs(tenantUser), {
      ...allowAll,
      isModuleEnabled: async () => false,
    });
    expect(await check(guard, TenantController, 'list')).toBe('module_not_enabled');
  });

  it('refuses a missing permission', async () => {
    const guard = new AccessGuard(authenticatesAs(tenantUser), {
      ...allowAll,
      hasPermission: async () => false,
    });
    expect(await check(guard, TenantController, 'list')).toBe('permission_denied');
  });

  it('allows when module and permission are granted', async () => {
    const guard = new AccessGuard(authenticatesAs(tenantUser), allowAll);
    expect(await check(guard, TenantController, 'list')).toBe('allowed');
  });

  it('denies an endpoint without an access declaration, whatever the user has', async () => {
    const guard = new AccessGuard(authenticatesAs(tenantUser), allowAll);
    expect(await check(guard, TenantController, 'undeclared')).toBe('permission_denied');
  });

  it('keeps platform staff and tenant users on their own endpoints', async () => {
    const asTenant = new AccessGuard(authenticatesAs(tenantUser), allowAll);
    const asStaff = new AccessGuard(authenticatesAs(platformUser), allowAll);
    expect(await check(asTenant, AdminController, 'tenants')).toBe('permission_denied');
    expect(await check(asStaff, AdminController, 'tenants')).toBe('allowed');
    expect(await check(asStaff, TenantController, 'list')).toBe('permission_denied');
    expect(await check(asStaff, TenantController, 'me')).toBe('permission_denied');
  });
});

describe('decorators', () => {
  it('reject badly named permissions at startup', () => {
    expect(() => RequirePermission('students.view')).toThrow();
    expect(() => RequirePermission('Students.Student.View')).toThrow();
  });
});

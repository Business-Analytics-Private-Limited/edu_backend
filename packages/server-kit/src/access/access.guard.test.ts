import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { runWithContext, type RequestContext } from '../context/request-context';
import { ProblemError } from '../errors/problem';
import { AccessGuard, DenyAllAuthorization, type AuthorizationPort } from './access.guard';
import { AuthenticatedOnly, Public, RequireModule, RequirePermission } from './decorators';

class TestController {
  @Public()
  health(): void {}

  @AuthenticatedOnly()
  me(): void {}

  @RequireModule('students')
  @RequirePermission('students.student.view')
  list(): void {}

  undeclared(): void {}
}

function executionContext(handler: keyof TestController): ExecutionContext {
  return {
    getHandler: () => TestController.prototype[handler],
    getClass: () => TestController,
  } as unknown as ExecutionContext;
}

const signedIn: RequestContext = {
  requestId: 'req-00000001',
  actorType: 'user',
  tenantId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e8f',
  userId: '0192a5f4-7c1e-7b3a-9d2e-1f4b5c6d7e90',
};
const anonymous: RequestContext = { requestId: 'req-00000002', actorType: 'user' };

const allowAll: AuthorizationPort = {
  isModuleEnabled: async () => true,
  hasPermission: async () => true,
};

async function problemCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'allowed';
  } catch (error) {
    if (error instanceof ProblemError) return error.code;
    throw error;
  }
}

describe('AccessGuard', () => {
  it('lets anyone reach a public endpoint', async () => {
    const guard = new AccessGuard(new DenyAllAuthorization());
    const result = runWithContext(anonymous, () => guard.canActivate(executionContext('health')));
    await expect(result).resolves.toBe(true);
  });

  it('requires a signed-in user for everything else', async () => {
    const guard = new AccessGuard(allowAll);
    const code = await problemCode(
      runWithContext(anonymous, () => guard.canActivate(executionContext('me'))),
    );
    expect(code).toBe('unauthenticated');
  });

  it('lets any signed-in user reach an authenticated-only endpoint', async () => {
    const guard = new AccessGuard(new DenyAllAuthorization());
    const result = runWithContext(signedIn, () => guard.canActivate(executionContext('me')));
    await expect(result).resolves.toBe(true);
  });

  it('refuses a module the tenant is not entitled to', async () => {
    const guard = new AccessGuard({ ...allowAll, isModuleEnabled: async () => false });
    const code = await problemCode(
      runWithContext(signedIn, () => guard.canActivate(executionContext('list'))),
    );
    expect(code).toBe('module_not_enabled');
  });

  it('refuses a missing permission', async () => {
    const guard = new AccessGuard({ ...allowAll, hasPermission: async () => false });
    const code = await problemCode(
      runWithContext(signedIn, () => guard.canActivate(executionContext('list'))),
    );
    expect(code).toBe('permission_denied');
  });

  it('allows when module and permission are granted', async () => {
    const guard = new AccessGuard(allowAll);
    const result = runWithContext(signedIn, () => guard.canActivate(executionContext('list')));
    await expect(result).resolves.toBe(true);
  });

  it('denies an endpoint without an access declaration, whatever the user has', async () => {
    const guard = new AccessGuard(allowAll);
    const code = await problemCode(
      runWithContext(signedIn, () => guard.canActivate(executionContext('undeclared'))),
    );
    expect(code).toBe('permission_denied');
  });
});

describe('decorators', () => {
  it('reject badly named permissions at startup', () => {
    expect(() => RequirePermission('students.view')).toThrow();
    expect(() => RequirePermission('Students.Student.View')).toThrow();
  });
});

/**
 * AccessGuard decides who may call an endpoint. These tests call it directly with a fake
 * request, without a database.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUser } from '../current-user';
import { AccessRule } from '../decorators/access.decorators';
import { AccessGuard } from './access.guard';

const superAdmin: CurrentUser = {
  type: 'super_admin',
  id: 's1',
  name: 'Super',
  email: 's@x',
  organizationId: null,
  roleName: null,
  permissions: [],
  enabledModules: [],
};

const teacher: CurrentUser = {
  type: 'user',
  id: 'u1',
  name: 'Teacher',
  email: 't@x',
  organizationId: 'org1',
  roleName: 'Teacher',
  permissions: ['platform.institution.view', 'students.student.view'],
  enabledModules: [],
};

/** Runs the guard for an endpoint with `rule`, called by `user`. */
function check(rule: AccessRule | undefined, user: CurrentUser | undefined) {
  const reflector = { getAllAndOverride: () => rule } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return new AccessGuard(reflector).canActivate(context);
}

describe('AccessGuard', () => {
  it('lets anyone call a public endpoint', () => {
    expect(check({ kind: 'public' }, undefined)).toBe(true);
  });

  it('closes an endpoint that has no access rule', () => {
    expect(() => check(undefined, superAdmin)).toThrow(ForbiddenException);
  });

  it('keeps super admin routes for super admins', () => {
    expect(check({ kind: 'super_admin' }, superAdmin)).toBe(true);
    expect(() => check({ kind: 'super_admin' }, teacher)).toThrow('Super admins only');
  });

  it('keeps organization routes for organization users', () => {
    expect(check({ kind: 'organization_user' }, teacher)).toBe(true);
    expect(() => check({ kind: 'organization_user' }, superAdmin)).toThrow(
      'Organization users only',
    );
  });

  it('needs the permission in the user role', () => {
    expect(check({ kind: 'permission', permission: 'platform.institution.view' }, teacher)).toBe(
      true,
    );
    expect(() => check({ kind: 'permission', permission: 'access.user.manage' }, teacher)).toThrow(
      'Your role needs the permission "access.user.manage"',
    );
  });

  it('needs the module of the permission to be switched on', () => {
    expect(() =>
      check({ kind: 'permission', permission: 'students.student.view' }, teacher),
    ).toThrow('The students module is not switched on for your organization');
    const withStudents = { ...teacher, enabledModules: ['students'] };
    expect(check({ kind: 'permission', permission: 'students.student.view' }, withStudents)).toBe(
      true,
    );
  });
});

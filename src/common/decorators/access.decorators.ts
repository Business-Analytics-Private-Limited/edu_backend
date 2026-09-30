/**
 * WHO MAY CALL AN ENDPOINT. Put exactly one of these on every controller method (or on the
 * controller class, for all its methods). An endpoint without one is refused (AccessGuard).
 *
 *   @Public()                             anyone, no login (login, health check)
 *   @LoggedIn()                           anyone logged in (e.g. "who am I")
 *   @SuperAdminOnly()                     EduPlatform staff only (the super admin area)
 *   @OrganizationUser()                   any user of an organization (e.g. its dashboard)
 *   @RequirePermission('access.user.create')
 *                                         a user of an organization whose role has this permission,
 *                                         when the permission's module is switched on
 */
import { SetMetadata } from '@nestjs/common';

export const ACCESS_RULE = 'accessRule';

export type AccessRule =
  | { kind: 'public' }
  | { kind: 'logged_in' }
  | { kind: 'super_admin' }
  | { kind: 'organization_user' }
  | { kind: 'permission'; permission: string };

export const Public = () => SetMetadata(ACCESS_RULE, { kind: 'public' } satisfies AccessRule);

export const LoggedIn = () => SetMetadata(ACCESS_RULE, { kind: 'logged_in' } satisfies AccessRule);

export const SuperAdminOnly = () =>
  SetMetadata(ACCESS_RULE, { kind: 'super_admin' } satisfies AccessRule);

export const OrganizationUser = () =>
  SetMetadata(ACCESS_RULE, { kind: 'organization_user' } satisfies AccessRule);

export const RequirePermission = (permission: string) =>
  SetMetadata(ACCESS_RULE, { kind: 'permission', permission } satisfies AccessRule);

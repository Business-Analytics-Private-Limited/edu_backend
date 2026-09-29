/**
 * Access decorators. Every endpoint must carry one of these combinations (CLAUDE.md rule 3),
 * or the architecture test fails:
 *
 *   @RequireModule('students') + @RequirePermission('students.student.view')   normal endpoints
 *   @AuthenticatedOnly()                                                        the caller's own data (/me)
 *   @Public()                                                                   health checks only
 *
 * Who may call an endpoint at all:
 *   (nothing)             tenant users, logged in through the `tenants` realm (the default)
 *   @PlatformEndpoint()   platform staff, logged in through the `platform` realm (/admin/...)
 *
 * The decorators only attach labels; AccessGuard (access.guard.ts) reads them on every request.
 */
import 'reflect-metadata';
import { SetMetadata } from '@nestjs/common';

export const MODULE_METADATA_KEY = 'edu:module';
export const PERMISSION_METADATA_KEY = 'edu:permission';
export const ACCESS_MODE_METADATA_KEY = 'edu:access-mode';
export const PLATFORM_ENDPOINT_METADATA_KEY = 'edu:platform-endpoint';

export type AccessMode = 'public' | 'authenticated';

const MODULE_KEY = /^[a-z_]+$/;
const PERMISSION = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;

/** Check 1 and 2 (doc 4 §4.1): the tenant must be entitled to this module. */
export function RequireModule(moduleKey: string): MethodDecorator & ClassDecorator {
  if (!MODULE_KEY.test(moduleKey)) throw new Error(`Invalid module key: ${moduleKey}`);
  return SetMetadata(MODULE_METADATA_KEY, moduleKey);
}

/** Check 3 (doc 4 §4.1): one of the user's roles must grant this permission. */
export function RequirePermission(permission: string): MethodDecorator & ClassDecorator {
  if (!PERMISSION.test(permission)) {
    throw new Error(`Permission must look like module.resource.action: ${permission}`);
  }
  return SetMetadata(PERMISSION_METADATA_KEY, permission);
}

/** No authentication at all. Only for health checks (docs/08-api-conventions.md §8.3). */
export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(ACCESS_MODE_METADATA_KEY, 'public' satisfies AccessMode);
}

/** Any authenticated user, for the caller's own data such as `/me/*`. */
export function AuthenticatedOnly(): MethodDecorator & ClassDecorator {
  return SetMetadata(ACCESS_MODE_METADATA_KEY, 'authenticated' satisfies AccessMode);
}

/**
 * Only platform staff (Keycloak realm `platform`) may call this endpoint. Put it on every
 * super admin controller (`/admin/...`, docs/08-api-conventions.md §8.2). Tenant users are
 * refused, and platform staff are refused everywhere else.
 */
export function PlatformEndpoint(): MethodDecorator & ClassDecorator {
  return SetMetadata(PLATFORM_ENDPOINT_METADATA_KEY, true);
}

export interface AccessDeclaration {
  mode?: AccessMode;
  moduleKey?: string;
  permission?: string;
  /** True for super admin endpoints (@PlatformEndpoint). */
  platform: boolean;
}

/** What an endpoint declared; method-level metadata wins over class-level metadata. */
export function readAccessDeclaration(handler: object, controller: object): AccessDeclaration {
  const read = <T>(key: string): T | undefined =>
    (Reflect.getMetadata(key, handler) as T | undefined) ??
    (Reflect.getMetadata(key, controller) as T | undefined);
  return {
    mode: read<AccessMode>(ACCESS_MODE_METADATA_KEY),
    moduleKey: read<string>(MODULE_METADATA_KEY),
    permission: read<string>(PERMISSION_METADATA_KEY),
    platform: read<boolean>(PLATFORM_ENDPOINT_METADATA_KEY) === true,
  };
}

/** True when the endpoint satisfies CLAUDE.md rule 3. */
export function isAccessDeclared(declaration: AccessDeclaration): boolean {
  return Boolean(declaration.mode || (declaration.moduleKey && declaration.permission));
}

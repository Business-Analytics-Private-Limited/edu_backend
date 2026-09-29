/**
 * Injection tokens for the database connection pools (ADR-0009).
 *
 * The host app creates the pools; services receive them by token:
 *
 *   constructor(@Inject(APP_POOL) private readonly pool: Pool) {}
 *
 *   APP_POOL       role edu_app: tenant work, always limited to one tenant by Row-Level Security.
 *   PLATFORM_POOL  role edu_platform: super admin work. Sees all tenants, but ONLY in schema
 *                  "platform". Use it only in @PlatformEndpoint code and platform-level jobs.
 */
//
// Tokens shared between packages use Symbol.for(name): it returns the same symbol even when a
// package is loaded twice (as test runners sometimes do), so injection always finds the value.
export const APP_POOL = Symbol.for('eduplatform.APP_POOL');
export const PLATFORM_POOL = Symbol.for('eduplatform.PLATFORM_POOL');

/**
 * @eduplatform/server-kit: the shared toolbox of every backend app and service.
 *
 * Nothing here is business logic. It is the plumbing that makes the project's rules
 * (CLAUDE.md) easy to follow and hard to break. See this package's README for a tour.
 */
import { join } from 'node:path';

// Who is making the request (tenant, user, request id), available anywhere in the call chain.
export * from './context/request-context';

// Database: pools, transactions scoped to one tenant, and the migration runner.
export * from './db/errors';
export * from './db/migrations';
export * from './db/pools';
export * from './db/transaction';

// Caching of frequently asked answers (entitlements, permissions).
export * from './cache/memory-cache';

// Authentication: checking Keycloak tokens and finding our own record of the caller.
export * from './auth/authenticator';
export * from './auth/token-verifier';

// Access control: @RequireModule / @RequirePermission / @Public and the global guard.
export * from './access/access.guard';
export * from './access/decorators';

// Writing business changes safely: audit entries and outbox events.
export * from './audit/audit';
export * from './outbox/outbox';
export * from './outbox/relay';

// HTTP: error responses (problem details) and the per-request middleware.
export * from './errors/problem';
export * from './http/pagination';
export * from './http/problem.filter';
export * from './http/request-context.middleware';
export * from './http/uuid.pipe';
export * from './http/validation';

// Everything else.
export * from './config/local-env';
export * from './ids';
export * from './logging/logger';
export * from './service/service-definition';

/** Folder of the foundation migrations (schema `app`). They run before every service's. */
export const FOUNDATION_MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

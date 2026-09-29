/**
 * Request context: who the current request or background job is acting for.
 *
 * Opened by the request middleware (or by a job), then read anywhere without passing it
 * around, e.g. `requireTenantId()` inside a repository. Node's AsyncLocalStorage keeps each
 * request's context separate even when many requests run at the same time.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type ActorType = 'user' | 'platform_user' | 'system' | 'device';

/**
 * Everything the backend knows about the current request or job (doc 3 §3.2, "Tenant resolution").
 * Lives in AsyncLocalStorage so that the database layer, audit writer and logger can read it
 * without passing it through every call.
 */
export interface RequestContext {
  requestId: string;
  actorType: ActorType;
  tenantId?: string;
  userId?: string;
  /** Platform user acting as `userId` during impersonation. */
  impersonatorId?: string;
  institutionId?: string;
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const context = storage.getStore();
  if (!context) throw new Error('No request context: run this code inside runWithContext()');
  return context;
}

export function requireTenantId(): string {
  const tenantId = requireContext().tenantId;
  if (!tenantId) throw new Error('No tenant in the request context');
  return tenantId;
}

/** Adds what later steps learn, e.g. the user and tenant once the token has been verified. */
export function updateContext(patch: Partial<RequestContext>): void {
  Object.assign(requireContext(), patch);
}

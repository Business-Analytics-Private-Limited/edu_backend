/**
 * Errors that are safe to show to API clients.
 *
 * Throw one of these from any service; ProblemFilter (http/problem.filter.ts) turns it into
 * an RFC 9457 "problem details" response with the right status code:
 *
 *   throw new NotFoundError();                    // 404, also for records outside the user's scope
 *   throw new ValidationError([{ path: 'dateOfBirth', code: 'invalid_date', message: '…' }]);
 *
 * Any other error becomes a plain 500 and its details go only to the logs.
 */

/** Stable error codes (docs/08-api-conventions.md §8.6). */
export type ProblemCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'module_not_enabled'
  | 'permission_denied'
  | 'not_found'
  | 'version_conflict'
  | 'conflict'
  | 'validation_failed'
  | 'limit_reached'
  | 'rate_limited'
  | 'service_unavailable'
  | 'internal_error';

export interface FieldError {
  path: string;
  code: string;
  message: string;
}

/** An error that is safe to show to the client as RFC 9457 problem details. */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? title);
    this.name = 'ProblemError';
  }
}

export class UnauthenticatedError extends ProblemError {
  constructor(detail?: string) {
    super(401, 'unauthenticated', 'Authentication required', detail);
  }
}

export class ModuleNotEnabledError extends ProblemError {
  constructor(moduleKey: string) {
    super(
      403,
      'module_not_enabled',
      'Module not available',
      `The ${moduleKey} module is not enabled`,
    );
  }
}

export class PermissionDeniedError extends ProblemError {
  constructor(detail?: string) {
    super(403, 'permission_denied', 'Permission denied', detail);
  }
}

/** Also used for records outside the caller's scope, so their existence is never revealed. */
export class NotFoundError extends ProblemError {
  constructor(detail?: string) {
    super(404, 'not_found', 'Not found', detail);
  }
}

export class ConflictError extends ProblemError {
  constructor(detail?: string) {
    super(409, 'conflict', 'Conflict', detail);
  }
}

export class VersionConflictError extends ProblemError {
  constructor() {
    super(
      409,
      'version_conflict',
      'Version conflict',
      'The record was changed by someone else; reload it',
    );
  }
}

export class ValidationError extends ProblemError {
  constructor(errors: FieldError[], detail = `${errors.length} field(s) are invalid`) {
    super(422, 'validation_failed', 'Validation failed', detail, errors);
  }
}

export class ServiceUnavailableError extends ProblemError {
  constructor(detail?: string) {
    super(503, 'service_unavailable', 'Service unavailable', detail);
  }
}

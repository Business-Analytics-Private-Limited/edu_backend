/**
 * Checking request input against a zod schema (docs/08-api-conventions.md §8.7).
 *
 *   const body = parseInput(createTenantSchema, request.body);   // typed, or 422 with field errors
 *
 * Schemas are strict: unknown fields are rejected, so a client can never set fields such as
 * tenantId, createdBy or version by adding them to the body.
 */
import type { z } from 'zod';
import { ProblemError, ValidationError, type FieldError } from '../errors/problem';

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const errors: FieldError[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(body)',
    code: issue.code,
    message: issue.message,
  }));
  throw new ValidationError(errors);
}

/**
 * Reads the version from an `If-Match: "3"` header (optimistic locking, §8.4).
 * @throws 400 when the header is missing or not a version number
 */
export function parseIfMatch(header: string | undefined): number {
  const match = /^\s*(?:W\/)?"?(\d+)"?\s*$/.exec(header ?? '');
  if (!match?.[1]) {
    throw new ProblemError(
      400,
      'bad_request',
      'If-Match required',
      'Send the version you are changing as If-Match: "<version>" (from the ETag header)',
    );
  }
  return Number(match[1]);
}

/**
 * Recognising database errors that mean "the client asked for something impossible", so a
 * service can answer 409 instead of 500. Drizzle wraps driver errors, so both the error and
 * its cause are checked.
 *
 *   try { await insertInstitution(); }
 *   catch (error) { if (isUniqueViolation(error)) throw new ConflictError('Code already used'); throw error; }
 */
function postgresCode(error: unknown): string | undefined {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** A unique constraint was violated (e.g. a slug or code already exists). */
export function isUniqueViolation(error: unknown): boolean {
  return postgresCode(error) === '23505';
}

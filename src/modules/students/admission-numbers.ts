/**
 * ADMISSION NUMBERS (ADR-0030): the organization admin chooses
 *   AUTOMATIC  every new student gets the next number of the organization's pattern; a number
 *              typed in the form or the import sheet is ignored;
 *   MANUAL     the number is typed in the form / given in each sheet row, and required.
 * In both modes a number is unique in the whole organization.
 *
 * Parts of a pattern:
 *   {CODE}    the organization's code             SVJC
 *   {BRANCH}  the student's branch code           KPHB   (each branch gets its own counter)
 *   {YYYY}    year of the admission date          2026
 *   {YY}      the same, two digits                26
 *   {SEQ:4}   a running number, 4 digits          0001   (1 to 8 digits; required, once)
 *   anything else is copied as it is (letters, digits, / _ -)
 *
 *   "{CODE}{YY}{SEQ:4}"          ->  SVJC260001, SVJC260002, ...   (restarts every year)
 *   "{CODE}/{BRANCH}/{SEQ:4}"    ->  SVJC/KPHB/0001 ...            (a counter per branch)
 *
 * The counters are kept in admission_sequences. Numbers already taken are skipped.
 */
import { BadRequestException } from '@nestjs/common';
import type { Db } from '../../prisma/prisma.service';

const ALLOWED = /^(\{CODE\}|\{BRANCH\}|\{YYYY\}|\{YY\}|\{SEQ:[1-8]\}|[A-Za-z0-9/_-])+$/;

/** Throws 400 if the pattern can't be used. */
export function checkPattern(pattern: string) {
  if (!ALLOWED.test(pattern)) {
    throw new BadRequestException(
      'A pattern may contain {CODE}, {BRANCH}, {YYYY}, {YY}, {SEQ:n} (n = 1 to 8) and letters, digits, / _ -',
    );
  }
  if ((pattern.match(/\{SEQ:[1-8]\}/g) ?? []).length !== 1) {
    throw new BadRequestException('A pattern needs exactly one running number, e.g. {SEQ:4}');
  }
}

/** The number for one value of the running number. */
export function render(
  pattern: string,
  parts: { code: string; branch: string; year: number },
  sequence: number,
): string {
  return pattern
    .replace('{CODE}', parts.code)
    .replace('{BRANCH}', parts.branch)
    .replace('{YYYY}', String(parts.year))
    .replace('{YY}', String(parts.year).slice(-2))
    .replace(/\{SEQ:([1-8])\}/, (_, digits: string) =>
      String(sequence).padStart(Number(digits), '0'),
    );
}

export interface Numbering {
  organizationId: string;
  code: string;
  admissionNumbering: 'AUTOMATIC' | 'MANUAL';
  admissionNoPattern: string | null;
}

/**
 * The admission number for a new student: the typed one (MANUAL), or the next free number of the
 * pattern (AUTOMATIC).
 */
export async function admissionNumberFor(
  db: Db,
  organization: Numbering,
  branch: { id: string; code: string },
  admissionDate: Date,
  typed: string | undefined,
): Promise<string> {
  if (organization.admissionNumbering === 'MANUAL') {
    if (!typed) throw new BadRequestException('Enter the admission number');
    return typed;
  }
  const pattern = organization.admissionNoPattern;
  if (!pattern) {
    throw new BadRequestException(
      'Automatic admission numbers need a pattern (Students → Settings)',
    );
  }
  const year = admissionDate.getUTCFullYear();
  const period = pattern.includes('{YY') ? String(year) : '';
  const scope = pattern.includes('{BRANCH}') ? branch.id : '';

  for (let attempt = 0; attempt < 10_000; attempt++) {
    const counter = await db.admissionSequence.upsert({
      where: {
        organizationId_scope_period: { organizationId: organization.organizationId, scope, period },
      },
      create: { organizationId: organization.organizationId, scope, period, nextValue: 2 },
      update: { nextValue: { increment: 1 } },
    });
    const candidate = render(
      pattern,
      { code: organization.code, branch: branch.code, year },
      counter.nextValue - 1,
    );
    const taken = await db.student.findFirst({
      where: { organizationId: organization.organizationId, admissionNo: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new BadRequestException('Could not find a free admission number; check the pattern');
}

/**
 * AUTOMATIC ADMISSION NUMBERS.
 *
 * An institution can set a pattern; an admission with an empty admission number then gets the
 * next number. Parts of a pattern:
 *   {CODE}    the institution's code              SVJC
 *   {YYYY}    year of the admission date          2026
 *   {YY}      the same, two digits                26
 *   {SEQ:4}   a running number, 4 digits          0001   (1 to 8 digits; required, once)
 *   anything else is copied as it is (letters, digits, / _ -)
 *
 *   "{CODE}{YY}{SEQ:4}"   ->  SVJC260001, SVJC260002, ...  (restarts every year)
 *   "ADM/{SEQ:5}"         ->  ADM/00001, ...               (never restarts)
 *
 * With {YY} or {YYYY} the running number restarts every year; the counters are kept in
 * admission_sequences. Numbers already taken (e.g. typed by hand) are skipped.
 */
import { BadRequestException } from '@nestjs/common';
import type { Db } from '../../prisma/prisma.service';

const ALLOWED = /^(\{CODE\}|\{YYYY\}|\{YY\}|\{SEQ:[1-8]\}|[A-Za-z0-9/_-])+$/;

/** Throws 400 if the pattern can't be used. */
export function checkPattern(pattern: string) {
  if (!ALLOWED.test(pattern)) {
    throw new BadRequestException(
      'A pattern may contain {CODE}, {YYYY}, {YY}, {SEQ:n} (n = 1 to 8) and letters, digits, / _ -',
    );
  }
  if ((pattern.match(/\{SEQ:[1-8]\}/g) ?? []).length !== 1) {
    throw new BadRequestException('A pattern needs exactly one running number, e.g. {SEQ:4}');
  }
}

/** The number for one value of the running number, e.g. render(pattern, 'SVJC', 2026, 7). */
export function render(pattern: string, code: string, year: number, sequence: number): string {
  return pattern
    .replace('{CODE}', code)
    .replace('{YYYY}', String(year))
    .replace('{YY}', String(year).slice(-2))
    .replace(/\{SEQ:([1-8])\}/, (_, digits: string) =>
      String(sequence).padStart(Number(digits), '0'),
    );
}

/** The next free admission number of the institution, for an admission on `admissionDate`. */
export async function nextAdmissionNo(
  db: Db,
  institution: {
    id: string;
    organizationId: string;
    code: string;
    admissionNoPattern: string | null;
  },
  admissionDate: Date,
): Promise<string> {
  const pattern = institution.admissionNoPattern;
  if (!pattern) {
    throw new BadRequestException(
      'Enter an admission number: this institution has no automatic numbering',
    );
  }
  const year = admissionDate.getUTCFullYear();
  const period = pattern.includes('{YY') ? String(year) : '';

  for (let attempt = 0; attempt < 10_000; attempt++) {
    const counter = await db.admissionSequence.upsert({
      where: { institutionId_period: { institutionId: institution.id, period } },
      create: {
        organizationId: institution.organizationId,
        institutionId: institution.id,
        period,
        nextValue: 2,
      },
      update: { nextValue: { increment: 1 } },
    });
    const candidate = render(pattern, institution.code, year, counter.nextValue - 1);
    const taken = await db.student.findFirst({
      where: { institutionId: institution.id, admissionNo: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new BadRequestException('Could not find a free admission number; check the pattern');
}

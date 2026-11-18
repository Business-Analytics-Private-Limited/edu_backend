/**
 * THE RULES FOR A STUDENT'S DETAILS (ADR-0031), in one place: the admission form, editing and
 * the import all use them, so a sheet row is checked exactly like the form.
 *
 *   - formats (used by the DTOs in dto/student.dto.ts with class-validator):
 *       names      letters, spaces, . ' -            e.g. "K. Ravi Teja"
 *       phone      10-digit Indian mobile, 6-9 first  "+91 98765-43210" is cleaned to 9876543210
 *       aadhaar    12 digits, not starting 0 or 1, with a valid check digit (Verhoeff)
 *   - rules across fields (checkStudentRules): the date of birth against the admission date, a
 *     pickup point when the student uses the bus;
 *   - words a sheet may use for fixed lists (CATEGORY_WORDS ...): "BC-A", "bca" and "BC_A" all
 *     mean BC_A.
 */
import type {
  Gender,
  LearnerLevel,
  PreviousBoard,
  ReservationCategory,
  Residence,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { registerDecorator, type ValidationOptions } from 'class-validator';

// --- Formats -------------------------------------------------------------------------------------

export const NAME = /^[A-Za-z][A-Za-z .'’-]*$/;
export const NAME_MESSAGE = (field: string) =>
  `${field} may only contain letters, spaces, dots, apostrophes and hyphens`;

export const PHONE = /^[6-9]\d{9}$/;
export const PHONE_MESSAGE = (field: string) =>
  `${field} must be a 10-digit mobile number starting with 6, 7, 8 or 9`;

/** Short codes: hall ticket and test numbers. */
export const CODE = /^[A-Za-z0-9/-]+$/;
export const CODE_MESSAGE = (field: string) => `${field} may only contain letters, digits, / and -`;

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** "+91 98765-43210", "098765 43210" -> "9876543210"; anything else is left for the check. */
export function cleanPhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const digits = value.replace(/[\s()-]/g, '');
  const match = digits.match(/^(?:\+?91|0)?(\d{10})$/);
  return match ? match[1] : value.trim();
}

/** "2345 6789 0123" -> "234567890123". */
export function cleanAadhaar(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '') : value;
}

/** Cleans a phone number before it is checked (DTO fields). */
export const CleanPhone = () => Transform(({ value }) => cleanPhone(value));
export const CleanAadhaar = () => Transform(({ value }) => cleanAadhaar(value));

// The Verhoeff check digit, as used by Aadhaar.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** 12 digits, not starting with 0 or 1, and the last digit is the right Verhoeff check digit. */
export function isValidAadhaar(value: string): boolean {
  if (!/^[2-9]\d{11}$/.test(value)) return false;
  let c = 0;
  const digits = value.split('').reverse().map(Number);
  digits.forEach((digit, i) => {
    c = D[c][P[i % 8][digit]];
  });
  return c === 0;
}

/** class-validator decorator for isValidAadhaar. */
export function IsAadhaar(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isAadhaar',
      target: object.constructor,
      propertyName,
      options: {
        message: 'aadhaar must be a valid 12-digit Aadhaar number (check the digits)',
        ...options,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidAadhaar(value),
      },
    });
}

/** "XXXX-XXXX-1234", for users without "students.sensitive.view". */
export const maskAadhaar = (value: string | null) =>
  value ? `XXXX-XXXX-${value.slice(-4)}` : null;

// --- Rules across fields -------------------------------------------------------------------------

export const MIN_AGE = 3;
export const MAX_AGE = 30;

/**
 * Problems that need more than one field. `admissionDate` is the day the age is counted at
 * (today when editing an existing student's other details is not checked against it).
 */
export function checkStudentRules(s: {
  dateOfBirth?: string | Date | null;
  admissionDate?: string | Date | null;
  busFacility?: boolean | null;
  pickupPoint?: string | null;
}): string[] {
  const problems: string[] = [];
  if (s.dateOfBirth && s.admissionDate) {
    const born = new Date(s.dateOfBirth);
    const admitted = new Date(s.admissionDate);
    if (born >= admitted) {
      problems.push('dateOfBirth must be before the admission date');
    } else {
      const age = yearsBetween(born, admitted);
      if (age < MIN_AGE || age > MAX_AGE) {
        problems.push(
          `the student must be ${MIN_AGE} to ${MAX_AGE} years old at admission (is ${age})`,
        );
      }
    }
  }
  if (s.busFacility && !s.pickupPoint?.trim()) {
    problems.push('pickupPoint is required when the student uses the bus');
  }
  return problems;
}

function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const before =
    to.getUTCMonth() < from.getUTCMonth() ||
    (to.getUTCMonth() === from.getUTCMonth() && to.getUTCDate() < from.getUTCDate());
  if (before) years--;
  return years;
}

// --- Words a sheet may use -----------------------------------------------------------------------

/** Upper case, without spaces, dots, hyphens and underscores: "BC-A" -> "BCA". */
export const squash = (value: string) => value.toUpperCase().replace(/[\s._-]/g, '');

export const GENDER_WORDS: Record<string, Gender> = {
  M: 'MALE',
  MALE: 'MALE',
  BOY: 'MALE',
  F: 'FEMALE',
  FEMALE: 'FEMALE',
  GIRL: 'FEMALE',
  O: 'OTHER',
  OTHER: 'OTHER',
};

export const CATEGORY_WORDS: Record<string, ReservationCategory> = {
  OC: 'OC',
  GENERAL: 'OC',
  GEN: 'OC',
  BCA: 'BC_A',
  BCB: 'BC_B',
  BCC: 'BC_C',
  BCD: 'BC_D',
  BCE: 'BC_E',
  SC: 'SC',
  ST: 'ST',
  EWS: 'EWS',
  OTHER: 'OTHER',
};

export const RESIDENCE_WORDS: Record<string, Residence> = {
  DAY: 'DAY_SCHOLAR',
  DAYSCHOLAR: 'DAY_SCHOLAR',
  DAYS: 'DAY_SCHOLAR',
  HOSTEL: 'HOSTELLER',
  HOSTELLER: 'HOSTELLER',
  HOSTLER: 'HOSTELLER',
  RESIDENTIAL: 'HOSTELLER',
};

export const BOARD_WORDS: Record<string, PreviousBoard> = {
  SSC: 'SSC',
  STATE: 'SSC',
  STATEBOARD: 'SSC',
  BSEAP: 'SSC',
  BSETS: 'SSC',
  CBSE: 'CBSE',
  ICSE: 'ICSE',
  INTER: 'INTERMEDIATE',
  INTERMEDIATE: 'INTERMEDIATE',
  IPE: 'INTERMEDIATE',
  BIE: 'INTERMEDIATE',
  IB: 'IB',
  OTHER: 'OTHER',
};

export const LEARNER_WORDS: Record<string, LearnerLevel> = {
  EXPERT: 'EXPERT',
  MEDIUM: 'MEDIUM',
  MEDIUMLEARNER: 'MEDIUM',
  SLOW: 'SLOW',
  SLOWLEARNER: 'SLOW',
};

export const YES_NO_WORDS: Record<string, boolean> = {
  YES: true,
  Y: true,
  TRUE: true,
  '1': true,
  ACTIVE: true,
  NO: false,
  N: false,
  FALSE: false,
  '0': false,
  INACTIVE: false,
};

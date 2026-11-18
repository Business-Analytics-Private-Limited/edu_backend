/**
 * WHAT EACH TYPE OF ORGANIZATION GETS (ADR-0030): the levels of its academic structure, and the
 * built-in parts it chooses from. One engine for all types: the structure is always a tree of
 * classes (classes table) that follows these levels; only the levels and the built-in parts
 * differ.
 *
 *   SCHOOL         Class -> Section                         classes from Nursery to Class 10
 *   INTERMEDIATE   Year -> Group -> Stream -> Section       Junior / Senior / Long Term;
 *                                                           MPC, BiPC, CEC, HEC; "Regular (IPE)"
 *   DEGREE         Course -> Specialization -> Year -> Section   the years 1st ... Nth Year
 *   ENGINEERING    (same as DEGREE)
 *
 * The YEAR LEVEL is the level whose classes are a year of study: promotion moves students from
 * one class of that level to its `next` class (Class 9 -> Class 10, Junior -> Senior,
 * 1st Year -> 2nd Year). The last level is always the SECTION, where students are placed.
 */
import type { OrganizationType } from '@prisma/client';

export interface Preset {
  /** Level names, top to bottom; the organization may rename them, not add or remove. */
  levels: string[];
  /** Which level (1 = top) is the year of study. */
  yearLevel: number;
}

export const PRESETS: Record<OrganizationType, Preset> = {
  SCHOOL: { levels: ['Class', 'Section'], yearLevel: 1 },
  INTERMEDIATE: { levels: ['Year', 'Group', 'Stream', 'Section'], yearLevel: 1 },
  DEGREE: { levels: ['Course', 'Specialization', 'Year', 'Section'], yearLevel: 3 },
  ENGINEERING: { levels: ['Course', 'Specialization', 'Year', 'Section'], yearLevel: 3 },
};

/** The number of levels of a type: the last one is the section. */
export function sectionLevel(type: OrganizationType): number {
  return PRESETS[type].levels.length;
}

export interface BuiltInClass {
  code: string;
  name: string;
}

/** School: the classes an organization ticks (in this order; each one's next is the following). */
export const SCHOOL_CLASSES: BuiltInClass[] = [
  { code: 'NUR', name: 'Nursery' },
  { code: 'LKG', name: 'LKG' },
  { code: 'UKG', name: 'UKG' },
  ...Array.from({ length: 10 }, (_, i) => ({ code: `C${i + 1}`, name: `Class ${i + 1}` })),
];

/** Intermediate: the years. Junior moves on to Senior; Senior and Long Term complete. */
export const INTERMEDIATE_YEARS = {
  junior: { code: 'JR', name: 'Junior (1st Year)' },
  senior: { code: 'SR', name: 'Senior (2nd Year)' },
  /** For students who already finished Intermediate (e.g. NEET repeaters): one year, long-term
   *  streams only, no promotion. */
  longTerm: { code: 'LT', name: 'Long Term' },
};

/** Intermediate: the groups an organization switches on. */
export const INTERMEDIATE_GROUPS: BuiltInClass[] = [
  { code: 'MPC', name: 'MPC' },
  { code: 'BIPC', name: 'BiPC' },
  { code: 'CEC', name: 'CEC' },
  { code: 'HEC', name: 'HEC' },
];

/** Intermediate: the stream every group has, for students without coaching. */
export const REGULAR_STREAM: BuiltInClass = { code: 'REG', name: 'Regular (IPE)' };

/** Degree / Engineering: "1st Year", "2nd Year", ... */
export function yearOfStudy(n: number): BuiltInClass {
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return { code: `Y${n}`, name: `${n}${suffix} Year` };
}

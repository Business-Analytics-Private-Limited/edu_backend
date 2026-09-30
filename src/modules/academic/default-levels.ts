/**
 * The class levels a new institution starts with, by its type. The institution can rename them,
 * or (while it has no classes yet) choose a different number of levels, e.g.
 * Type -> Group -> Stream -> Section.
 *
 * The last level is always where students are placed (a "section").
 */
import type { InstitutionType } from '@prisma/client';

export const DEFAULT_LEVELS: Record<InstitutionType, string[]> = {
  JUNIOR_COLLEGE: ['Year', 'Group', 'Section'],
  DEGREE_COLLEGE: ['Year', 'Course', 'Section'],
  ENGINEERING_COLLEGE: ['Year', 'Branch', 'Section'],
  SCHOOL: ['Class', 'Section'],
};

/** Most levels an institution may have. */
export const MAX_LEVELS = 6;

/**
 * The class levels every new institution starts with. Institutions have no type (ADR-0025):
 * each one renames these, or (while it has no classes yet) chooses its own levels, e.g.
 * Year -> Group -> Section, or Type -> Group -> Stream -> Section.
 *
 * The last level is always where students are placed (a "section").
 */
export const DEFAULT_LEVELS = ['Class', 'Section'];

/** Most levels an institution may have. */
export const MAX_LEVELS = 6;

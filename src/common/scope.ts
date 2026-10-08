/**
 * WHERE a user may do something (ADR-0030).
 *
 * A user's roles each apply at a PLACE:
 *   the whole organization       { }               (no branch)
 *   one branch                   { branchId }
 *
 * The AccessGuard only checks that the user has a permission SOMEWHERE. Services then use these
 * helpers to check the permission at the place of the record they touch:
 *
 *   assertCan(user, 'students.student.update', { branchId: student.branchId });
 *   const reach = reachOf(user, 'students.student.view');   // to filter lists
 *
 * Things that belong to the whole organization (academic years, the academic structure above
 * sections, subjects, settings) are changed with the permission for the whole organization
 * ({ }) and seen by anyone who has the view permission somewhere (canSomewhere).
 */
import { ForbiddenException } from '@nestjs/common';
import type { CurrentUser, Grant } from './current-user';

export interface Place {
  /** Empty = something that belongs to the whole organization. */
  branchId?: string | null;
}

/** Does a role given at `grant`'s place also reach `place`? */
export function covers(grant: Place, place: Place): boolean {
  if (!grant.branchId) return true; // whole organization
  return !!place.branchId && place.branchId === grant.branchId;
}

/** May the user do `permission` at `place`? (place {} = something organization-wide) */
export function can(user: CurrentUser, permission: string, place: Place): boolean {
  return user.grants.some((g) => g.permissions.includes(permission) && covers(g, place));
}

/** Has the user got `permission` anywhere (a branch or the whole organization)? */
export function canSomewhere(user: CurrentUser, permission: string): boolean {
  return user.grants.some((g) => g.permissions.includes(permission));
}

/** The permissions from `wanted` that the user does NOT have at `place`. */
export function missingAt(user: CurrentUser, wanted: string[], place: Place): string[] {
  return wanted.filter((p) => !can(user, p, place));
}

/** Has the user got `permission` for the whole organization? */
export function canEverywhere(user: CurrentUser, permission: string): boolean {
  return can(user, permission, {});
}

/**
 * Where the user has `permission`: everywhere, or a list of branches.
 * Used to filter lists (students, users, audit log) to what the user may see.
 */
export type Reach = { everywhere: true } | { everywhere: false; branchIds: string[] };

export function reachOf(user: CurrentUser, permission: string): Reach {
  const grants = user.grants.filter((g) => g.permissions.includes(permission));
  if (grants.some((g) => !g.branchId)) return { everywhere: true };
  return { everywhere: false, branchIds: [...new Set(grants.map((g) => g.branchId!))] };
}

/** Is `place` inside the reach? */
export function inReach(reach: Reach, place: Place): boolean {
  if (reach.everywhere) return true;
  return !!place.branchId && reach.branchIds.includes(place.branchId);
}

/** Throws 403 unless the user has `permission` at `place`. */
export function assertCan(user: CurrentUser, permission: string, place: Place): void {
  if (!can(user, permission, place)) {
    throw new ForbiddenException(
      `Your roles don't allow "${permission}" for ${describePlace(place)}`,
    );
  }
}

/** A short text for a place, for error messages. */
export function describePlace(place: Place): string {
  return place.branchId ? 'this branch' : 'the whole organization';
}

export type { Grant };

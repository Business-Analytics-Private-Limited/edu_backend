/**
 * WHERE a user may do something (ADR-0018).
 *
 * A user's roles each apply at a PLACE:
 *   the whole organization       { }                                  (no ids)
 *   one institution              { institutionId }                    (and all its campuses)
 *   one campus                   { institutionId, campusId }
 *
 * The AccessGuard only checks that the user has a permission SOMEWHERE. Services then use these
 * helpers to check the permission at the place of the record they touch:
 *
 *   if (!can(user, 'access.user.update', { institutionId, campusId })) throw new ForbiddenException();
 *   const where = placeFilter(user, 'access.user.view');   // only what the user may see
 */
import { ForbiddenException } from '@nestjs/common';
import type { CurrentUser, Grant } from './current-user';

export interface Place {
  institutionId?: string | null;
  campusId?: string | null;
}

/** Does a role given at `grant`'s place also reach `place`? */
export function covers(grant: Place, place: Place): boolean {
  if (!grant.institutionId && !grant.campusId) return true; // whole organization
  if (grant.campusId) return !!place.campusId && place.campusId === grant.campusId;
  return !!place.institutionId && place.institutionId === grant.institutionId; // institution
}

/** May the user do `permission` at `place`? (place {} = something organization-wide) */
export function can(user: CurrentUser, permission: string, place: Place): boolean {
  return user.grants.some((g) => g.permissions.includes(permission) && covers(g, place));
}

/** The permissions from `wanted` that the user does NOT have at `place`. */
export function missingAt(user: CurrentUser, wanted: string[], place: Place): string[] {
  return wanted.filter((p) => !can(user, p, place));
}

/**
 * May the user use `permission` anywhere inside this institution (the institution itself or one
 * of its campuses)? For VIEWING institution-wide things, e.g. a Campus admin sees their
 * institution's academic years and class levels.
 */
export function canSomewhereIn(
  user: CurrentUser,
  permission: string,
  institutionId: string,
): boolean {
  return user.grants.some(
    (g) =>
      g.permissions.includes(permission) &&
      ((!g.institutionId && !g.campusId) || g.institutionId === institutionId),
  );
}

/** Has the user got `permission` for the whole organization? */
export function canEverywhere(user: CurrentUser, permission: string): boolean {
  return can(user, permission, {});
}

/**
 * Where the user has `permission`: everywhere, or a list of institutions and campuses.
 * Used to filter lists (users, institutions, audit log) to what the user may see.
 */
export type Reach =
  { everywhere: true } | { everywhere: false; institutionIds: string[]; campusIds: string[] };

export function reachOf(user: CurrentUser, permission: string): Reach {
  const grants = user.grants.filter((g) => g.permissions.includes(permission));
  if (grants.some((g) => !g.institutionId && !g.campusId)) return { everywhere: true };
  return {
    everywhere: false,
    institutionIds: grants
      .filter((g) => g.institutionId && !g.campusId)
      .map((g) => g.institutionId!),
    campusIds: grants.filter((g) => g.campusId).map((g) => g.campusId!),
  };
}

/** Is `place` inside the reach? */
export function inReach(reach: Reach, place: Place): boolean {
  if (reach.everywhere) return true;
  return (
    (!!place.campusId && reach.campusIds.includes(place.campusId)) ||
    (!!place.institutionId && reach.institutionIds.includes(place.institutionId))
  );
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
  if (place.campusId) return 'this campus';
  if (place.institutionId) return 'this institution';
  return 'the whole organization';
}

export type { Grant };

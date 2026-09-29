/**
 * Who is making the request. Built by JwtStrategy (src/modules/auth/jwt.strategy.ts) from the
 * login token, on every request, and available in controllers through @CurrentUser().
 */
export interface CurrentUser {
  /** "super_admin" = EduPlatform staff; "user" = someone who belongs to one organization. */
  type: 'super_admin' | 'user';
  id: string;
  name: string;
  email: string;

  // The fields below are only filled for type "user".
  organizationId: string | null;
  roleName: string | null;
  /** Permission keys from the user's role, e.g. "access.user.manage". */
  permissions: string[];
  /** Keys of the modules switched on for the user's organization, e.g. "students". */
  enabledModules: string[];
}

/** What we put inside a login token (keep it small: identity only, no permissions). */
export interface JwtPayload {
  sub: string; // the user's id
  type: CurrentUser['type'];
}

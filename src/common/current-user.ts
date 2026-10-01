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
  /**
   * "staff" works in the web app with roles. "parent" / "student" use the portal: they have NO
   * roles or permissions and only see the students in `studentIds` (ADR-0022).
   */
  kind: 'staff' | 'parent' | 'student' | null;
  /** Portal users: the students they may see (a parent's children, or the student). */
  studentIds: string[];
  /** Names of the user's roles, e.g. ["Principal", "Senior faculty"]. */
  roleNames: string[];
  /**
   * Everything any of the user's roles allows, anywhere, e.g. "access.user.create". Enough to
   * decide which menus and endpoints they may open; WHERE they may use it is in `grants`.
   */
  permissions: string[];
  /** Each role of the user with the place it applies to (see src/common/scope.ts). */
  grants: Grant[];
  /** Keys of the modules switched on for the user's organization, e.g. "students". */
  enabledModules: string[];
}

/** One role assignment: its permissions, and where they apply (no ids = whole organization). */
export interface Grant {
  roleName: string;
  permissions: string[];
  institutionId: string | null;
  campusId: string | null;
}

/** What we put inside a login token (keep it small: identity only, no permissions). */
export interface JwtPayload {
  sub: string; // the user's id
  type: CurrentUser['type'];
}

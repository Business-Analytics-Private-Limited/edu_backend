/**
 * EVERY PERMISSION a role can have (docs/04-roles-and-permissions.md).
 *
 * Permissions are written per RESOURCE (a thing in the app, e.g. "Institutions") and ACTION
 * (what you do with it). The key is module.resource.action, e.g. "platform.campus.create".
 *
 *   view    see it            create  add new ones
 *   update  edit ("Edit")     delete  remove
 *   ...plus special actions some resources need: mark, correct, import, export, promote, transfer.
 *
 * `module`: the module that must be switched on for the permission to work; null = always
 * available (part of every organization).
 *
 * To add a permission: add the action to a resource here (or a new resource), use it with
 * @RequirePermission('...') on an endpoint, and add it to docs/04-roles-and-permissions.md.
 * The Organization admin role gets new permissions automatically when the app starts.
 */

export interface ResourceInfo {
  /** module.resource, e.g. "platform.institution". */
  key: string;
  module: string | null;
  /** Heading the resource is shown under on the roles screen. */
  group: string;
  /** Name on the roles screen, e.g. "Institutions". */
  label: string;
  actions: string[];
}

export interface PermissionInfo {
  key: string;
  module: string | null;
  group: string;
  resource: string;
  action: string;
}

const CRUD = ['view', 'create', 'update', 'delete'];

export const RESOURCES: ResourceInfo[] = [
  // Organization (always available)
  {
    key: 'platform.organization',
    module: null,
    group: 'Organization',
    label: 'Organization details',
    actions: ['view', 'update'],
  },
  {
    key: 'platform.institution',
    module: null,
    group: 'Organization',
    label: 'Institutions',
    // Adding and deleting institutions is for the super admin only (ADR-0025).
    actions: ['view', 'update'],
  },
  {
    key: 'platform.campus',
    module: null,
    group: 'Organization',
    label: 'Campuses',
    // "delete" = deactivate (close) a campus; a real delete is for the Organization admin only
    // (ADR-0026).
    actions: ['create', 'update', 'delete'],
  },

  // Users and roles (always available)
  {
    key: 'access.user',
    module: null,
    group: 'Users and roles',
    label: 'Users',
    actions: ['view', 'create', 'update'],
  },
  { key: 'access.role', module: null, group: 'Users and roles', label: 'Roles', actions: CRUD },
  {
    key: 'audit.log',
    module: null,
    group: 'Users and roles',
    label: 'Audit log',
    actions: ['view'],
  },

  // Academic module
  {
    key: 'academic.year',
    module: 'academic',
    group: 'Academic',
    label: 'Academic years',
    actions: CRUD,
  },
  {
    key: 'academic.batch',
    module: 'academic',
    group: 'Academic',
    label: 'Batches',
    actions: CRUD,
  },
  {
    key: 'academic.structure',
    module: 'academic',
    group: 'Academic',
    label: 'Years, groups and sections',
    actions: CRUD,
  },
  {
    key: 'academic.subject',
    module: 'academic',
    group: 'Academic',
    label: 'Subjects',
    actions: CRUD,
  },
  {
    key: 'academic.calendar',
    module: 'academic',
    group: 'Academic',
    label: 'Holidays',
    actions: CRUD,
  },

  // Students module
  {
    key: 'students.student',
    module: 'students',
    group: 'Students',
    label: 'Students',
    actions: [...CRUD, 'import', 'export'],
  },
  {
    key: 'students.enrolment',
    module: 'students',
    group: 'Students',
    label: 'Promotion and transfers',
    actions: ['promote', 'transfer'],
  },
  {
    key: 'students.document',
    module: 'students',
    group: 'Students',
    label: 'Student documents',
    actions: CRUD,
  },
  {
    key: 'students.settings',
    module: 'students',
    group: 'Students',
    label: 'Student settings',
    actions: ['view', 'update'],
  },

  // Attendance module
  {
    key: 'attendance.record',
    module: 'attendance',
    group: 'Attendance',
    label: 'Attendance',
    actions: ['view', 'mark', 'correct'],
  },
  {
    key: 'attendance.policy',
    module: 'attendance',
    group: 'Attendance',
    label: 'Attendance rules',
    actions: ['view', 'update'],
  },
  {
    key: 'attendance.device',
    module: 'attendance',
    group: 'Attendance',
    label: 'Biometric devices',
    actions: CRUD,
  },
  {
    key: 'attendance.report',
    module: 'attendance',
    group: 'Attendance',
    label: 'Attendance reports',
    actions: ['view'],
  },

  // Data import module
  {
    key: 'imports.job',
    module: 'imports',
    group: 'Data import',
    label: 'Import jobs',
    actions: ['view'],
  },
];

/** The flat list: one entry per resource and action. */
export const PERMISSIONS: PermissionInfo[] = RESOURCES.flatMap((r) =>
  r.actions.map((action) => ({
    key: `${r.key}.${action}`,
    module: r.module,
    group: r.group,
    resource: r.key,
    action,
  })),
);

/** Everything: the Organization admin role always has all of these. */
export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const PERMISSION_KEYS = new Set(ALL_PERMISSION_KEYS);

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.has(key);
}

/** The module a permission needs, or null if it is always available. */
export function moduleOfPermission(key: string): string | null {
  return PERMISSIONS.find((p) => p.key === key)?.module ?? null;
}

/** Every "view" permission, e.g. for read-only roles. */
export const ALL_VIEW_KEYS = PERMISSIONS.filter((p) => p.action === 'view').map((p) => p.key);

/**
 * The permissions in `wanted` that `have` doesn't include. Used so nobody can hand out more
 * than they have themselves: a role you create, or a role you give someone, must be within
 * your own permissions.
 */
export function missingPermissions(wanted: string[], have: string[]): string[] {
  return wanted.filter((p) => !have.includes(p));
}

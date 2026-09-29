/**
 * EVERY PERMISSION an organization role can have (docs/04-roles-and-permissions.md).
 *
 * Name pattern: module.resource.action, e.g. "access.user.manage".
 * `module`: the module that must be switched on for the permission to work; null = always
 * available (part of every organization).
 *
 * To add a permission: add a line here, use it with @RequirePermission('...') on an endpoint,
 * and add it to docs/04-roles-and-permissions.md.
 */
export interface PermissionInfo {
  key: string;
  module: string | null;
  group: string;
  description: string;
}

export const PERMISSIONS: PermissionInfo[] = [
  // Organization (always available)
  {
    key: 'platform.institution.view',
    module: null,
    group: 'Organization',
    description: 'See the organization, institutions and campuses',
  },
  {
    key: 'platform.institution.manage',
    module: null,
    group: 'Organization',
    description: 'Create, edit and delete institutions',
  },
  {
    key: 'platform.campus.manage',
    module: null,
    group: 'Organization',
    description: 'Create, edit and delete campuses',
  },
  {
    key: 'platform.settings.manage',
    module: null,
    group: 'Organization',
    description: 'Edit organization details',
  },

  // Users and roles (always available)
  { key: 'access.user.view', module: null, group: 'Users and roles', description: 'See users' },
  {
    key: 'access.user.manage',
    module: null,
    group: 'Users and roles',
    description: 'Add, edit, deactivate users',
  },
  {
    key: 'access.role.manage',
    module: null,
    group: 'Users and roles',
    description: 'Create and edit roles',
  },
  {
    key: 'audit.log.view',
    module: null,
    group: 'Users and roles',
    description: 'See the audit log',
  },

  // Academic module
  {
    key: 'academic.structure.view',
    module: 'academic',
    group: 'Academic',
    description: 'See years, groups, sections, subjects',
  },
  {
    key: 'academic.structure.manage',
    module: 'academic',
    group: 'Academic',
    description: 'Edit the academic structure',
  },
  {
    key: 'academic.year.manage',
    module: 'academic',
    group: 'Academic',
    description: 'Manage academic years',
  },
  {
    key: 'academic.subject.manage',
    module: 'academic',
    group: 'Academic',
    description: 'Manage subjects',
  },
  {
    key: 'academic.calendar.manage',
    module: 'academic',
    group: 'Academic',
    description: 'Manage holidays',
  },

  // Students module
  {
    key: 'students.student.view',
    module: 'students',
    group: 'Students',
    description: 'See students',
  },
  {
    key: 'students.student.create',
    module: 'students',
    group: 'Students',
    description: 'Admit students',
  },
  {
    key: 'students.student.update',
    module: 'students',
    group: 'Students',
    description: 'Edit students',
  },
  {
    key: 'students.student.delete',
    module: 'students',
    group: 'Students',
    description: 'Delete students',
  },
  {
    key: 'students.student.import',
    module: 'students',
    group: 'Students',
    description: 'Import students from files',
  },
  {
    key: 'students.student.export',
    module: 'students',
    group: 'Students',
    description: 'Export student lists',
  },
  {
    key: 'students.enrolment.promote',
    module: 'students',
    group: 'Students',
    description: 'Promote to the next year',
  },
  {
    key: 'students.enrolment.transfer',
    module: 'students',
    group: 'Students',
    description: 'Move between sections',
  },
  {
    key: 'students.document.view',
    module: 'students',
    group: 'Students',
    description: 'See documents',
  },
  {
    key: 'students.document.manage',
    module: 'students',
    group: 'Students',
    description: 'Upload and verify documents',
  },
  {
    key: 'students.settings.manage',
    module: 'students',
    group: 'Students',
    description: 'Tags, custom fields, document types',
  },

  // Attendance module
  {
    key: 'attendance.record.view',
    module: 'attendance',
    group: 'Attendance',
    description: 'See attendance',
  },
  {
    key: 'attendance.record.mark',
    module: 'attendance',
    group: 'Attendance',
    description: 'Mark attendance',
  },
  {
    key: 'attendance.record.correct',
    module: 'attendance',
    group: 'Attendance',
    description: 'Correct attendance',
  },
  {
    key: 'attendance.policy.manage',
    module: 'attendance',
    group: 'Attendance',
    description: 'Attendance rules',
  },
  {
    key: 'attendance.device.manage',
    module: 'attendance',
    group: 'Attendance',
    description: 'Biometric devices',
  },
  {
    key: 'attendance.report.view',
    module: 'attendance',
    group: 'Attendance',
    description: 'Attendance reports',
  },

  // Data import module
  {
    key: 'imports.job.view',
    module: 'imports',
    group: 'Data import',
    description: 'See import jobs',
  },
];

const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.has(key);
}

/** The module a permission needs, or null if it is always available. */
export function moduleOfPermission(key: string): string | null {
  return PERMISSIONS.find((p) => p.key === key)?.module ?? null;
}

/** Everything: given to the "Organization admin" role of every new organization. */
export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

/**
 * THE BUILT-IN PREDEFINED ROLES every organization has (docs/04-roles-and-permissions.md).
 *
 * These are the STARTING permissions. The super admin can change them later in the super admin
 * console (Predefined roles), and create more predefined roles there (ADR-0030); the changes are
 * kept in the database (table role_templates). Each organization has its own copy of each role
 * and may change that copy's permissions for itself (ADR-0029).
 *
 * Each role is given to a user AT A PLACE: the whole organization or one branch (ADR-0030).
 * E.g. "Principal" at KPHB, "Branch admin" at KPHB (the same person may have both), "Director"
 * for the whole organization.
 *
 * `assignable: false` = not given from the Users page. Parent and Student logins are created
 * from a student's record (Students module), so they only ever see their own children / record.
 */
import { ALL_PERMISSION_KEYS, ALL_VIEW_KEYS } from './permissions';

export interface PredefinedRole {
  key: string;
  name: string;
  description: string;
  permissions: string[];
  assignable: boolean;
}

/** The key of the role that always has every permission and can never be changed. */
export const ORG_ADMIN = 'org_admin';

/** What a Branch admin may do at their branch. A Principal gets all of it too (see below). */
const BRANCH_ADMIN_PERMISSIONS = [
  'platform.organization.view',
  'platform.branch.view',
  'access.user.view',
  'access.user.create',
  'access.user.update',
  'access.role.view',
  'audit.log.view',
  'academic.year.view',
  // Sections of their branch (the structure above them is the organization's).
  'academic.structure.view',
  'academic.structure.create',
  'academic.structure.update',
  'academic.structure.delete',
  'academic.subject.view',
  'academic.calendar.view',
  'academic.calendar.create',
  'academic.calendar.update',
  'academic.calendar.delete',
  'students.student.view',
  'students.student.create',
  'students.student.update',
  'students.student.import',
  'students.student.export',
  'students.sensitive.view',
  'students.enrolment.transfer',
  'students.document.view',
  'students.document.create',
  'students.document.update',
  'students.document.delete',
  'attendance.record.view',
  'attendance.record.mark',
  'attendance.record.correct',
  'attendance.policy.view',
  'attendance.device.view',
  'attendance.device.create',
  'attendance.device.update',
  'attendance.report.view',
  'imports.job.view',
];

export const PREDEFINED_ROLES: PredefinedRole[] = [
  {
    key: ORG_ADMIN,
    name: 'Organization admin',
    description: 'Full access to everything in the organization',
    permissions: ALL_PERMISSION_KEYS,
    assignable: true,
  },
  {
    key: 'director',
    name: 'Director',
    description:
      'Sees everything in every branch, with filters by branch, class, group, stream and section',
    permissions: [...ALL_VIEW_KEYS, 'platform.branch.update', 'students.student.export'],
    assignable: true,
  },
  {
    key: 'principal',
    name: 'Principal',
    description: 'Runs a branch: academics, students, promotion and attendance',
    // Everything a Branch admin can do at the branch (so they can also appoint Branch admins),
    // plus promotion, student settings and attendance rules.
    permissions: [
      ...new Set([
        ...BRANCH_ADMIN_PERMISSIONS,
        'students.enrolment.promote',
        'students.settings.view',
        'attendance.policy.update',
      ]),
    ],
    assignable: true,
  },
  {
    key: 'branch_admin',
    name: 'Branch admin',
    description: 'Runs one branch: its staff, sections, students, documents and attendance',
    permissions: BRANCH_ADMIN_PERMISSIONS,
    assignable: true,
  },
  {
    key: 'senior_faculty',
    name: 'Senior faculty',
    description: 'Teaches, marks and corrects attendance, sees student documents and reports',
    permissions: [
      'platform.branch.view',
      'academic.year.view',
      'academic.structure.view',
      'academic.subject.view',
      'academic.calendar.view',
      'students.student.view',
      'students.document.view',
      'attendance.record.view',
      'attendance.record.mark',
      'attendance.record.correct',
      'attendance.report.view',
    ],
    assignable: true,
  },
  {
    key: 'junior_faculty',
    name: 'Junior faculty',
    description: 'Teaches and marks attendance',
    permissions: [
      'platform.branch.view',
      'academic.year.view',
      'academic.structure.view',
      'academic.subject.view',
      'academic.calendar.view',
      'students.student.view',
      'attendance.record.view',
      'attendance.record.mark',
    ],
    assignable: true,
  },
  {
    key: 'dtp_operator',
    name: 'DTP operator',
    description: 'Data entry: adds and edits students and their documents, no deleting',
    permissions: [
      'platform.branch.view',
      'academic.year.view',
      'academic.structure.view',
      'students.student.view',
      'students.student.create',
      'students.student.update',
      'students.student.import',
      'students.document.view',
      'students.document.create',
      'students.document.update',
      'imports.job.view',
    ],
    assignable: true,
  },
  {
    key: 'parent',
    name: 'Parent',
    description: "Sees only their own children's profile and attendance",
    permissions: ['students.student.view', 'students.document.view', 'attendance.record.view'],
    assignable: false,
  },
  {
    key: 'student',
    name: 'Student',
    description: 'Sees only their own profile and attendance',
    permissions: ['students.student.view', 'students.document.view', 'attendance.record.view'],
    assignable: false,
  },
];

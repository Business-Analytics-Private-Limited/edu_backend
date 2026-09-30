/**
 * THE PREDEFINED ROLES every organization has (docs/04-roles-and-permissions.md).
 *
 * These are the STARTING permissions. The super admin can change them later in the super admin
 * console (Predefined roles); the changes are kept in the database (table role_templates) and
 * apply to every organization at once. Organization admins can assign these roles to users but
 * can't change or delete them; they create their own roles for anything else.
 *
 * `assignable: false` = not given from the Users page. Parent and Student logins will be created
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
    description: 'Oversees all institutions: sees everything, manages institutions and campuses',
    permissions: [
      ...ALL_VIEW_KEYS,
      'platform.institution.create',
      'platform.institution.update',
      'platform.campus.create',
      'platform.campus.update',
      'students.student.export',
    ],
    assignable: true,
  },
  {
    key: 'principal',
    name: 'Principal',
    description: 'Runs an institution: academics, students and attendance',
    permissions: [
      'platform.organization.view',
      'platform.institution.view',
      'platform.institution.update',
      'platform.campus.create',
      'platform.campus.update',
      'access.user.view',
      'access.role.view',
      'academic.year.view',
      'academic.year.create',
      'academic.year.update',
      'academic.structure.view',
      'academic.structure.create',
      'academic.structure.update',
      'academic.subject.view',
      'academic.subject.create',
      'academic.subject.update',
      'academic.calendar.view',
      'academic.calendar.create',
      'academic.calendar.update',
      'students.student.view',
      'students.student.create',
      'students.student.update',
      'students.student.export',
      'students.enrolment.promote',
      'students.enrolment.transfer',
      'students.document.view',
      'students.document.update',
      'attendance.record.view',
      'attendance.record.correct',
      'attendance.policy.view',
      'attendance.policy.update',
      'attendance.report.view',
    ],
    assignable: true,
  },
  {
    key: 'senior_faculty',
    name: 'Senior faculty',
    description: 'Teaches, marks and corrects attendance, sees student documents and reports',
    permissions: [
      'platform.institution.view',
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
      'platform.institution.view',
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
      'platform.institution.view',
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

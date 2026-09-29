/**
 * Catalog entries for v1 modules whose service code doesn't exist yet.
 *
 * The super admin must be able to grant, say, Students and Attendance before those services
 * are built (the Phase 2 exit check does exactly that). So their manifests are listed here,
 * copied from docs/modules/<module>.md.
 *
 * WHEN A SERVICE IS BUILT: move its manifest into services/<name>/src/manifest.ts and delete
 * it from this list. The catalog sync prefers a service's own manifest anyway.
 */
import type { ModuleManifest } from '@eduplatform/contracts';

const ALL_TYPES: ModuleManifest['appliesTo'] = [
  'junior_college',
  'degree_college',
  'engineering_college',
  'school',
];

export const PLANNED_MODULES: ModuleManifest[] = [
  // --- Core services built later in Phase 2 ---------------------------------------------------
  {
    key: 'identity',
    name: 'Users and login',
    version: 1,
    category: 'platform',
    core: true,
    dependsOn: [],
    appliesTo: ALL_TYPES,
    variants: [],
    permissions: [],
    events: { publishes: ['identity.user.created', 'identity.user.deactivated'], consumes: [] },
  },
  {
    key: 'access',
    name: 'Roles and permissions',
    version: 1,
    category: 'platform',
    core: true,
    dependsOn: [],
    appliesTo: ALL_TYPES,
    variants: [],
    permissions: [
      { key: 'access.user.view', description: 'View users and their role assignments' },
      { key: 'access.user.manage', description: 'Invite, edit, deactivate users' },
      { key: 'access.role.manage', description: 'Create and change roles; assign and revoke them' },
    ],
    events: { publishes: ['access.role.changed', 'access.assignment.changed'], consumes: [] },
    navigation: [
      { path: '/users', label: 'Users', permission: 'access.user.view' },
      { path: '/roles', label: 'Roles', permission: 'access.role.manage' },
    ],
  },
  {
    key: 'files',
    name: 'Files',
    version: 1,
    category: 'supporting',
    core: true,
    dependsOn: [],
    appliesTo: ALL_TYPES,
    variants: [],
    limits: [{ key: 'storage.maxGb', default: 20 }],
    permissions: [],
    events: { publishes: ['files.file.uploaded'], consumes: [] },
  },

  // --- Business modules -----------------------------------------------------------------------
  {
    key: 'academic',
    name: 'Academic',
    version: 1,
    category: 'academics',
    dependsOn: [],
    appliesTo: ALL_TYPES,
    variants: [
      { key: 'junior_college_v1', name: 'Junior college structure', default: true },
      { key: 'degree_v1', name: 'Degree college structure', status: 'planned' },
      { key: 'engineering_v1', name: 'Engineering college structure', status: 'planned' },
      { key: 'school_v1', name: 'School structure', status: 'planned' },
    ],
    variantSelection: 'multiple',
    permissions: [
      {
        key: 'academic.structure.view',
        description: 'See the structure tree, years, subjects, holidays',
      },
      { key: 'academic.structure.manage', description: 'Create, edit and deactivate nodes' },
      { key: 'academic.year.manage', description: 'Manage academic years and year offerings' },
      { key: 'academic.subject.manage', description: 'Manage subjects and their mapping' },
      { key: 'academic.calendar.manage', description: 'Manage holidays' },
    ],
    events: {
      publishes: ['academic.node.created', 'academic.node.updated', 'academic.year.activated'],
      consumes: ['platform.institution.changed'],
    },
    navigation: [
      { path: '/academic', label: 'Academic structure', permission: 'academic.structure.view' },
    ],
  },
  {
    key: 'students',
    name: 'Students',
    version: 1,
    category: 'academics',
    dependsOn: ['academic'],
    appliesTo: ALL_TYPES,
    variants: [
      { key: 'manual', name: 'Admission numbers entered by staff', default: true },
      { key: 'auto_pattern', name: 'Admission numbers generated from a pattern' },
    ],
    variantSelection: 'single',
    limits: [{ key: 'students.max', default: 2000 }],
    permissions: [
      { key: 'students.student.view', description: 'View students within scope' },
      { key: 'students.student.create', description: 'Admit students' },
      {
        key: 'students.student.update',
        description: 'Edit profile, guardians, tags; change status',
      },
      { key: 'students.student.delete', description: 'Delete records created by mistake' },
      { key: 'students.student.import', description: 'Bulk import' },
      { key: 'students.student.export', description: 'Export lists' },
      { key: 'students.enrolment.promote', description: 'Promote to the next year' },
      { key: 'students.enrolment.transfer', description: 'Move between sections' },
      { key: 'students.document.view', description: 'View and download documents' },
      { key: 'students.document.manage', description: 'Upload, verify, delete documents' },
      { key: 'students.settings.manage', description: 'Tags, custom fields, document types' },
    ],
    events: {
      publishes: [
        'students.student.admitted',
        'students.student.status_changed',
        'students.enrolment.changed',
      ],
      consumes: ['academic.node.updated'],
    },
    navigation: [{ path: '/students', label: 'Students', permission: 'students.student.view' }],
  },
  {
    key: 'attendance',
    name: 'Attendance',
    version: 1,
    category: 'academics',
    dependsOn: ['academic', 'students'],
    appliesTo: ALL_TYPES,
    variants: [
      { key: 'manual', name: 'Manual marking', default: true },
      { key: 'biometric', name: 'Biometric devices' },
      { key: 'rfid', name: 'RFID cards', status: 'planned' },
      { key: 'qr', name: 'QR code scan', status: 'planned' },
      { key: 'mobile_geo', name: 'Mobile app, geo-fenced', status: 'planned' },
    ],
    variantSelection: 'multiple',
    limits: [{ key: 'devices.max', default: 5 }],
    permissions: [
      { key: 'attendance.record.view', description: 'View records within scope' },
      { key: 'attendance.record.mark', description: 'Mark attendance for sections in scope' },
      {
        key: 'attendance.record.correct',
        description: 'Correct records within the correction window',
      },
      { key: 'attendance.policy.manage', description: 'Manage policies and period definitions' },
      { key: 'attendance.device.manage', description: 'Register devices and manage mappings' },
      { key: 'attendance.report.view', description: 'View reports within scope' },
    ],
    events: {
      publishes: ['attendance.record.marked', 'attendance.record.corrected'],
      consumes: ['students.enrolment.changed'],
    },
    navigation: [
      { path: '/attendance', label: 'Attendance', permission: 'attendance.record.view' },
      {
        path: '/attendance/devices',
        label: 'Devices',
        permission: 'attendance.device.manage',
        variant: 'biometric',
      },
    ],
  },
  {
    key: 'portal',
    name: 'Parent and student portal',
    version: 1,
    category: 'academics',
    dependsOn: ['students'],
    appliesTo: ALL_TYPES,
    variants: [
      { key: 'parent_login', name: 'Parent login', default: true },
      { key: 'student_login', name: 'Student login' },
    ],
    variantSelection: 'multiple',
    permissions: [],
    events: { publishes: [], consumes: [] },
  },
  {
    key: 'imports',
    name: 'Data import',
    version: 1,
    category: 'supporting',
    dependsOn: ['students', 'academic'],
    appliesTo: ALL_TYPES,
    variants: [
      { key: 'csv', name: 'CSV files', default: true },
      { key: 'excel', name: 'Excel files' },
    ],
    variantSelection: 'multiple',
    limits: [{ key: 'rows.maxPerJob', default: 10000 }],
    permissions: [{ key: 'imports.job.view', description: 'See import jobs and their results' }],
    events: { publishes: ['imports.job.completed'], consumes: [] },
  },
];

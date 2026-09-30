# Module: students

> **Status: design, not built yet.** Written before the backend was simplified; the purpose, data and rules still apply, the technical details (schemas, paths, `.manage` permissions, events) will follow today's conventions when it is built. See [README.md](README.md#reading-the-design-documents).

| | |
|---|---|
| Schema | `students` |
| Phase | 4 |
| Depends on | academic, identity, files |
| Code | `services/students/` |

## Purpose

The source of truth for students and their guardians: admission, profile, documents, which section a student is in each academic year, and the student's status over time.

## Responsibilities

- Admission (single, and bulk through `imports`), admission numbers.
- Student profile, photo, documents, custom fields, tags (batch, residence category).
- Guardians and the student ↔ guardian links; consent records (DPDP).
- Enrolments (student ↔ section ↔ year), section changes, promotion and shuffle with preview and undo.
- Status changes (active, transferred, discontinued, alumni) with history.
- Answering "which students may this guardian / student user see" for `access`.

Not this module: login accounts (`identity`), attendance, marks, fees.

## Manifest

- Variants (admission number mode): `manual` (default), `auto_pattern`.
- Settings (institution level):
  - `admissionNo.pattern`, e.g. `{INST}{YY}{SEQ:4}` → `SVJC260001` (auto_pattern only)
  - `requiredFields`: which optional profile fields are required at admission
  - `rollNo.mode`: `manual` or `auto_alphabetical`
- Limits: `students.max` (active students per tenant).

## Permissions

From doc 4:

| Permission | Allows |
|---|---|
| `students.student.view` | View students within scope |
| `students.student.create` | Admit students |
| `students.student.update` | Edit profile, guardians, tags; change status |
| `students.student.delete` | Soft delete (only for mistakes; normal exits use status) |
| `students.student.import` | Bulk import |
| `students.student.export` | Export lists |
| `students.enrolment.promote` | Promote to the next year |
| `students.enrolment.transfer` | Move between sections, shuffle |
| `students.document.view` | View and download documents |
| `students.document.manage` | Upload, verify, delete documents |
| `students.settings.manage` | Tags, custom fields, document types |

## Data model

```
students.students                                                                            [std][sd]
  id, tenant_id
  institution_id  uuid not null
  admission_no    text not null         unique (tenant_id, institution_id, admission_no) where deleted_at is null
  admission_date  date not null
  full_name       text not null  [P]   as in official records; no forced first/last split
  surname         text           [P]
  date_of_birth   date not null  [P]
  gender          text check (male | female | other | undisclosed)   [P]
  blood_group     text           [P][S]
  mother_tongue   text           [P]
  religion        text           [P][S]   optional
  social_category text           [P][S]   OC / BC-A … / SC / ST, for scholarships; optional
  aadhaar_last4   char(4)        [P][S]   the full number is never stored
  email           text           [P]
  phone           text           [P]
  address         jsonb          [P]   { current, permanent }
  photo_file_id   uuid
  previous_education jsonb       [P]   { board, hallTicketNo, school, passedYear, gpa }
  custom_fields   jsonb not null default '{}'
  status          text check (active | transferred | discontinued | alumni)
  status_changed_at timestamptz
  user_id         uuid                  student portal login
  gin index (tenant_id, full_name gin_trgm_ops)

students.student_status_history
  id, tenant_id, student_id
  from_status     text
  to_status       text not null
  effective_on    date not null
  reason          text
  changed_by      uuid
  changed_at      timestamptz not null

students.admission_sequences            auto_pattern numbering
  tenant_id, institution_id
  sequence_key    text                  e.g. '2026'
  next_value      integer not null
  primary key (tenant_id, institution_id, sequence_key)

students.guardians                                                                           [std][sd]
  id, tenant_id
  full_name       text not null  [P]
  phone           text           [P]   not unique: parents often share a number
  alt_phone       text           [P]
  email           text           [P]
  occupation      text           [P]
  address         jsonb          [P]
  user_id         uuid                  parent portal login
  index (tenant_id, phone)

students.student_guardians
  tenant_id, student_id, guardian_id
  relation        text check (father | mother | guardian | other)
  is_primary      boolean not null default false
  portal_access   boolean not null default false
  receives_notifications boolean not null default true
  primary key (tenant_id, student_id, guardian_id)

students.consents                       DPDP: consent for minors, given by a guardian
  id, tenant_id, student_id, guardian_id
  purpose         text not null         'portal_access', 'photo_publication', …
  granted_at      timestamptz not null
  method          text check (in_person_form | otp | portal)
  evidence_file_id uuid
  withdrawn_at    timestamptz

students.enrolments                                                                          [std][sd]
  id, tenant_id, student_id
  academic_year_id uuid not null
  institution_id  uuid not null
  campus_id       uuid not null
  node_id         uuid not null         enrolment-level node (section)
  node_ancestor_ids uuid[] not null     projection of academic ancestor_ids; GIN index
  roll_no         text
  status          text check (active | promoted | transferred_out | completed | discontinued)
  enrolled_on     date not null
  left_on         date
  unique (tenant_id, student_id, academic_year_id) where deleted_at is null
  unique (tenant_id, node_id, academic_year_id, roll_no) where roll_no is not null and deleted_at is null

students.enrolment_history
  id, tenant_id, enrolment_id, student_id
  from_node_id    uuid
  to_node_id      uuid
  change_type     text check (admitted | shuffled | promoted | transferred | left)
  effective_on    date not null
  reason          text
  bulk_operation_id uuid
  changed_by      uuid
  changed_at      timestamptz not null

students.bulk_operations                promotion and shuffle, with preview and undo              [std]
  id, tenant_id, institution_id
  kind            text check (promotion | shuffle)
  from_academic_year_id uuid
  to_academic_year_id uuid
  params          jsonb not null
  preview         jsonb                 proposed moves, editable before apply
  status          text check (previewed | applying | applied | undone | failed)
  affected_count  integer
  applied_at      timestamptz
  undone_at       timestamptz

students.tags                                                                                [std][sd]
  id, tenant_id, institution_id
  tag_group       text not null         'batch', 'residence', …
  code            text not null
  name            text not null
  unique (tenant_id, institution_id, tag_group, code) where deleted_at is null

students.student_tags
  tenant_id, student_id, tag_id
  academic_year_id uuid                 null = all years
  primary key (tenant_id, student_id, tag_id)

students.custom_field_definitions                                                            [std][sd]
  id, tenant_id
  institution_id  uuid                  null = all institutions
  entity          text check (student | guardian)
  key             text not null
  label           text not null
  data_type       text check (text | number | date | boolean | select)
  options         jsonb
  is_required     boolean not null default false
  is_pii          boolean not null default true
  sort_order      integer not null default 0

students.document_types                                                                      [std][sd]
  id, tenant_id
  institution_id  uuid
  code            text not null         'ssc_memo', 'tc', 'caste_certificate'
  name            text not null
  is_required     boolean not null default false
  allowed_content_types text[] not null default '{application/pdf,image/jpeg,image/png}'

students.student_documents                                                                   [std][sd]
  id, tenant_id, student_id, document_type_id
  file_id         uuid                  null when only the original is held
  status          text check (submitted | verified | rejected)
  original_held   boolean not null default false
  original_returned_at timestamptz
  verified_by     uuid
  verified_at     timestamptz
  remarks         text
```

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/students/students` | `students.student.list` | `students.student.view` | `?q&status&institutionId&campusId&nodeId&academicYearId&tagId`; scope-filtered |
| POST | `/students/students` | `students.student.admit` | `students.student.create` | Admit: profile, guardians and first enrolment in one transaction |
| GET | `/students/students/{studentId}` | `students.student.get` | `students.student.view` | Profile with current enrolment, guardians, tags |
| PATCH | `/students/students/{studentId}` | `students.student.update` | `students.student.update` | Edit profile (`If-Match`) |
| DELETE | `/students/students/{studentId}` | `students.student.delete` | `students.student.delete` | Soft delete, with reason |
| POST | `/students/students/{studentId}/status` | `students.student.change_status` | `students.student.update` | Change status with effective date and reason |
| GET | `/students/students/{studentId}/status-history` | `students.student.status_history` | `students.student.view` | Status history |
| POST | `/students/students/{studentId}/photo/upload-url` | `students.photo.upload_url` | `students.student.update` | Signed URL for the photo |
| PUT | `/students/students/{studentId}/photo` | `students.photo.set` | `students.student.update` | Confirm the uploaded photo |
| GET | `/students/students/{studentId}/guardians` | `students.guardian.list` | `students.student.view` | Guardians of a student |
| POST | `/students/students/{studentId}/guardians` | `students.guardian.link` | `students.student.update` | Link an existing guardian or create a new one |
| PATCH | `/students/guardians/{guardianId}` | `students.guardian.update` | `students.student.update` | Edit a guardian |
| DELETE | `/students/students/{studentId}/guardians/{guardianId}` | `students.guardian.unlink` | `students.student.update` | Unlink |
| POST | `/students/guardians/{guardianId}/portal-access` | `students.guardian.grant_portal` | `students.student.update` | Create the parent login (portal module must be enabled; consent required) |
| GET | `/students/students/{studentId}/consents` | `students.consent.list` | `students.student.view` | Consents |
| POST | `/students/students/{studentId}/consents` | `students.consent.record` | `students.student.update` | Record a consent |
| POST | `/students/consents/{consentId}/withdraw` | `students.consent.withdraw` | `students.student.update` | Withdraw |
| GET | `/students/students/{studentId}/enrolments` | `students.enrolment.list` | `students.student.view` | Enrolments by year, with history |
| POST | `/students/enrolments/{enrolmentId}/transfer` | `students.enrolment.transfer` | `students.enrolment.transfer` | Move one student to another section |
| POST | `/students/bulk-operations` | `students.bulk_operation.preview` | `students.enrolment.promote` or `.transfer` | Create a promotion or shuffle preview |
| GET | `/students/bulk-operations/{operationId}` | `students.bulk_operation.get` | same | Preview or result |
| PATCH | `/students/bulk-operations/{operationId}` | `students.bulk_operation.adjust` | same | Adjust individual moves in the preview |
| POST | `/students/bulk-operations/{operationId}/apply` | `students.bulk_operation.apply` | same | Apply (202; runs as a job) |
| POST | `/students/bulk-operations/{operationId}/undo` | `students.bulk_operation.undo` | same | Undo, if nothing changed since |
| GET | `/students/students/{studentId}/documents` | `students.document.list` | `students.document.view` | Documents |
| POST | `/students/students/{studentId}/documents/upload-url` | `students.document.upload_url` | `students.document.manage` | Signed upload URL |
| POST | `/students/students/{studentId}/documents` | `students.document.create` | `students.document.manage` | Register an uploaded or held document |
| PATCH | `/students/documents/{documentId}` | `students.document.update` | `students.document.manage` | Verify, reject, mark original returned |
| GET | `/students/documents/{documentId}/download-url` | `students.document.download_url` | `students.document.view` | Signed download URL |
| DELETE | `/students/documents/{documentId}` | `students.document.delete` | `students.document.manage` | Soft delete |
| POST | `/students/exports` | `students.student.export` | `students.student.export` | Export a filtered list (202; job; CSV / Excel) |
| GET, POST, PATCH, DELETE | `/students/tags`, `/students/custom-fields`, `/students/document-types` | `students.<setting>.*` | view: `students.student.view`; change: `students.settings.manage` | Institution settings lists |

## Events

Published:

| Type | When | Data |
|---|---|---|
| `students.student.admitted` | Admission | `studentId, institutionId, admissionNo, fullName, enrolment` |
| `students.student.updated` | Profile fields changed | `studentId, fields` (names only for personal fields) |
| `students.student.status_changed` | Status change | `studentId, from, to, effectiveOn` |
| `students.student.deleted` | Soft delete | `studentId` |
| `students.enrolment.changed` | Admitted, transferred, shuffled, promoted, left, undone | `enrolmentId, studentId, academicYearId, fromNodeId, toNodeId, nodeAncestorIds, changeType` |
| `students.guardian.linked` / `unlinked` | Link changes | `studentId, guardianId, userId` |

Consumed: `academic.node.updated` (refresh `node_ancestor_ids`), `identity.user.deactivated` (clear portal flags).

## Public facade

```ts
interface StudentsFacade {
  getStudent(studentId): Promise<StudentSummary | null>;
  getStudents(studentIds): Promise<StudentSummary[]>;
  getCurrentEnrolment(studentId, academicYearId?): Promise<Enrolment | null>;
  listRoster(nodeId, academicYearId, onDate?): Promise<RosterEntry[]>;
  studentIdsForGuardianUser(userId): Promise<string[]>;     // 'guardian' scope
  studentIdForStudentUser(userId): Promise<string | null>;   // 'self' scope
  admitFromImport(row: AdmitCommand): Promise<string>;       // used by imports
}
```

## Business rules

1. Admission creates the student, guardian links and first enrolment in one transaction; the enrolment node must be an enrolment-level node offered in that year (`AcademicFacade.isEnrolmentNode`).
2. `auto_pattern` admission numbers are issued by locking the sequence row, so two admissions never get the same number.
3. Normal exits change `status` (with history); delete is only for records created by mistake.
4. Enrolment moves always write `enrolment_history`.
5. Promotion preview lists every active student of the source year with the proposed target node; students can be excluded (e.g. detained). Apply sets the old enrolment to `promoted` and creates the new one. Undo is allowed while no enrolment in the batch has changed since.
6. Parent portal access requires a recorded `portal_access` consent for students under 18.
7. Admitting beyond `students.max` fails with `422 limit_reached`.

## Tests

- Admitting two students concurrently in `auto_pattern` mode gives consecutive, distinct numbers.
- Promotion of 1,000 students: preview, apply, undo returns every enrolment to its original state.
- A teacher scoped to section A lists only section A students; a direct GET of a section B student returns 404.
- A guardian linked to two children sees both and no one else.

## Open questions

- Which profile fields the first institution requires (from its current forms), for `requiredFields` defaults.

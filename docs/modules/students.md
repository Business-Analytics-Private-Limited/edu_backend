# Module: students (admission, profile, guardians, sections)

| | |
|---|---|
| Status | **Built:** admission, profile, status history, guardians, sections per year, promotion and shuffle, campus transfer, automatic admission numbers, import from CSV, undo of a promotion, **documents** |
| Code | `src/modules/students/` |
| Tables | `students`, `student_status_changes`, `guardians`, `student_guardians`, `enrolments`, `admission_sequences`, `promotion_runs`, `document_types`, `student_documents`; `institutions.admission_no_pattern` |
| Decisions | ADR-0020 (and ADR-0018 places, ADR-0019 academic structure) |
| Switched on by | the super admin, per organization (module key `students`, needs `academic`) |

## In plain words

- **Admission:** a student is admitted to a **campus** with an admission number (unique in the institution), name, date of birth, gender and contacts; optionally right away a **batch**, a **section** for an academic year, and a parent.
- **Status:** Active → Transferred / Discontinued / Alumni, each with a date and reason, kept as history. Leaving ends the current section.
- **Guardians:** father, mother, guardian; one is the main contact. Siblings share the same guardian record (find them by phone).
- **Sections:** one per academic year — a class of the institution's last level on the student's campus (e.g. *1st year › MPC › Section A*), with a roll number.
- **Promotion:** per campus, from one academic year to a later one. The preview suggests, for each section, the next class at the top level with the same path below (*1st year › MPC › A → 2nd year › MPC › A*; *Junior › … → Senior › …*), or **finish** (alumni) after the last one. The user can change any choice, move the batches to a new stage and keep roll numbers.
- **Undo of a promotion:** every applied promotion is recorded; it can be undone once (newest first in practice), all or nothing, and only while nothing changed since for its students (not moved on, left, or changed campus). Undo removes the new sections, re-activates the old ones and alumni, and gives batches their old stage.
- **Shuffle:** move ticked students to another section of the same campus in the same year.
- **Campus transfer:** to another campus of the same institution; the current section moves to one on the new campus.
- **Admission numbers:** typed by hand, or automatic per institution with a pattern such as `{CODE}{YY}{SEQ:4}` → *SVJC260001* (restarts every year with `{YY}`; numbers already taken are skipped).
- **Documents:** each institution lists the document types it collects (required? visible to parents?); on a student's page staff upload (PDF / JPG / PNG, 5 MB), download, verify or reject with a reason, and delete; required types without an accepted document show as missing. See [files.md](files.md) and ADR-0023.
- **Import:** students from a CSV file for one campus; every row is checked and problems are listed by row number; then all rows are saved, or none.

## Endpoints (`/api/v1`)

| Method | Path | Permission (at the student's campus) |
|---|---|---|
| GET | `/students?search=&campusId=&classId=&batchId=&academicYearId=&status=&page=` | `students.student.view` — only students in your reach; `classId` includes the sections below a class |
| POST | `/students` | `students.student.create` — admission (`enrolment`, `guardians` optional) |
| GET | `/students/:id` | `students.student.view` — profile, guardians, sections, status history |
| PATCH | `/students/:id` | `students.student.update` |
| POST | `/students/:id/status` | `students.student.update` — `{ status, effectiveOn, reason }` |
| DELETE | `/students/:id` | `students.student.delete` — mistakes only |
| GET | `/guardians?phone=` | `students.student.view` — guardians on record, to link a sibling |
| POST | `/students/:id/guardians` | `students.student.update` — a new person, or `existingGuardianId` |
| PATCH / DELETE | `/students/:id/guardians/:guardianId` | `students.student.update` |
| POST | `/students/:id/enrolments` | `students.student.update` — `{ academicYearId, classId, rollNo }` |
| PATCH | `/students/:id/enrolments/:enrolmentId` | roll no: `students.student.update`; another section: `students.enrolment.transfer` |
| GET | `/promotions/preview?campusId=&fromYearId=&toYearId=` | `students.enrolment.promote` — sections, their students, suggested target |
| POST | `/promotions` | `students.enrolment.promote` — `{ campusId, fromYearId, toYearId, mapping: [{ fromSectionId, toSectionId? , graduate? }], batchStage?, keepRollNumbers? }` |
| GET | `/promotions?campusId=` | `students.enrolment.promote` — applied promotions, newest first |
| POST | `/promotions/:id/undo` | `students.enrolment.promote` |
| POST | `/enrolments/move` | `students.enrolment.transfer` — `{ academicYearId, studentIds, toSectionId }` (roll numbers cleared) |
| POST | `/students/:id/transfer` | `students.enrolment.transfer` at BOTH campuses — `{ toCampusId, toSectionId?, reason? }` |
| POST | `/students/import` | `students.student.import` + `.create` at the campus — `{ campusId, academicYearId?, dryRun?, rows }`; returns `{ ok, total, imported, errors: [{ row, message }] }` |
| GET / POST / PATCH / DELETE | `/document-types`, `/document-types/:id` | view: `students.document.view`; change: `students.settings.update` for the institution |
| GET / POST | `/students/:id/documents` | `students.document.view` / `.create` (multipart: `file`, `documentTypeId`) |
| PATCH / DELETE | `/students/:id/documents/:docId` | `students.document.update` (verify / reject) / `.delete` |
| GET | `/students/:id/documents/:docId/file` | `students.document.view` — download |
| PUT | `/institutions/:id/admission-numbering` | `students.settings.update` for the institution — `{ pattern }` (empty = by hand) |

## Rules (tested in `test/students.e2e-spec.ts`)

1. Nothing works unless the organization has the Students module.
2. Admission numbers are unique in the institution.
3. A section must be a class of the last level, in use, on the student's campus; the year must be the institution's and not closed; one section per student per year; roll numbers unique per section and year.
4. A Campus admin sees, admits and changes only their campus's students; deleting needs `students.student.delete` (not in Campus admin by default).
5. A guardian can be linked to several students; removing the last link removes the guardian.
6. Promotion goes to a LATER year that isn't closed; students already placed in that year are left alone (applying twice changes nothing); old enrolments become PROMOTED, or COMPLETED + alumni for those who finish.
7. Import is all or nothing: with any problem (or `dryRun`) nothing is saved; at most 2000 rows.
8. Another organization sees none of it; every change goes to the audit log with its campus.

## Screens (web app → Students)

Students (search, campus and status filters) · Admit student · Promote (preview, adjust, apply) · Move students · Import students (template, check, import) · Student settings (admission numbers) · a student's page (profile, parents / guardians, sections per year with move and roll no, status and history).

## Next (part 2)

Bulk upload of documents, photos on the profile, documents for staff.

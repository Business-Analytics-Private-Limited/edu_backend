# Module: students (admission, profile, placements, outgoing students, promotion, import, documents)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/students/` |
| Tables | `students`, `student_status_changes`, `guardians`, `student_guardians`, `enrolments`, `admission_sequences`, `promotion_runs`, `document_types`, `student_documents`; `organizations.admission_numbering`, `admission_no_pattern` |
| Decisions | ADR-0020, ADR-0030 (branches, placements as periods, outgoing students, import into a section, admission numbering) |
| Switched on by | the super admin, per organization (module key `students`, needs `academic`) |

## In plain words

- **Admission:**
  - a student is admitted at a **branch**, with name, date of birth, gender and contacts
  - optionally, right away, a **section** for an academic year, and a parent
  - **lateral entry** (joining straight into Senior or 2nd Year) is normal; previous school / college and marks are optional fields
- **Admission numbers**, as the organization admin decides:
  - **Automatic:** from the organization's pattern, e.g. `{CODE}{YY}{SEQ:4}` → *SVJC260001*. `{BRANCH}` gives each branch its own counter, e.g. `{CODE}/{BRANCH}/{SEQ:4}`. A typed number is ignored.
  - **Manual:** typed in the form and the import sheet, required.
  - Unique in the whole organization either way.
- **Placements (enrolments) are periods:**
  - a student is in **one section of one branch**, in an academic year, from a date until a date
  - **changing section** (e.g. Regular → JEE Mains) or **changing branch** ends the current placement the day before and starts a new one, with the date and a reason
  - nothing is overwritten: the profile shows a **timeline**, and attendance before the change stays with the old section
  - this is done **for one student, from the profile**; a change on the placement's own first day simply corrects it
- **Current and outgoing:**
  - ACTIVE students are **current**
  - **Outgoing** students left: TRANSFERRED (took a TC), DISCONTINUED (dropped out), COMPLETED (finished the final year)
  - outgoing students are kept in full and readable, but hidden from current lists, registers and promotion
  - their portal login is closed, and so is a parent's login if they have no other current child
  - they can be **re-admitted**
  - leaving records the date, reason and, optionally, where they went
- **Guardians:** father, mother, guardian; one is the main contact. Siblings share the same guardian record (find them by phone).
- **Promotion (per branch, from one year to a later one):**
  - for each section, the suggested target follows the **progression** of its year (see [academic.md](academic.md)): Junior › MPC › JEE Mains › A → Senior › MPC › JEE Mains › A; Class 9 › A → Class 10 › A
  - after the final year (Class 10, Senior, Long Term) the students **complete**
  - the user can change any choice and keep roll numbers
  - every applied promotion is recorded and can be **undone** once, all or nothing, while nothing changed since
- **Import:**
  - choose **branch → year → the structure level by level → section** on the screen
  - the CSV has only the students' own columns, and every row goes into that section
  - every row is checked first; then all are saved, or none
- **Documents:**
  - the organization lists the document types it collects (required? visible to parents?)
  - staff upload, download, verify or reject, and delete
  - see [files.md](files.md) and ADR-0023

## Endpoints (`/api/v1`)

| Method | Path | Permission (at the student's branch) |
|---|---|---|
| GET | `/students?search=&branchId=&classId=&academicYearId=&show=current\|outgoing\|all&status=&page=` | `students.student.view`: only students in reach; `classId` = any class of the structure, in every branch |
| POST | `/students` | `students.student.create`: admission (`branchId`, `enrolment`, `guardians` optional) |
| GET | `/students/:id` | `students.student.view`: profile, guardians, placements (with `section` label), status history |
| PATCH | `/students/:id` | `students.student.update` |
| POST | `/students/:id/leave` | `students.student.update`: `{ status, effectiveOn, reason?, destination? }` → outgoing |
| POST | `/students/:id/readmit` | `students.student.update`: `{ effectiveOn, reason? }` |
| POST | `/students/:id/change-section` | `students.enrolment.transfer`: `{ classId, effectiveOn, reason?, rollNo? }` |
| POST | `/students/:id/change-branch` | `students.enrolment.transfer` at BOTH branches: `{ branchId, classId, effectiveOn, reason?, rollNo? }` |
| DELETE | `/students/:id` | `students.student.delete`: mistakes only (not with attendance on record) |
| GET | `/guardians?phone=` | `students.student.view`: guardians on record, to link a sibling |
| POST / PATCH / DELETE | `/students/:id/guardians[/:guardianId]` | `students.student.update` |
| POST | `/students/:id/enrolments` | `students.student.update`: place a current student without a section `{ academicYearId, classId, rollNo? }` |
| PATCH | `/students/:id/enrolments/:enrolmentId` | `students.student.update`: `{ rollNo }` |
| GET | `/promotions/preview?branchId=&fromYearId=&toYearId=` | `students.enrolment.promote` |
| POST | `/promotions` | `students.enrolment.promote`: `{ branchId, fromYearId, toYearId, mapping: [{ fromSectionId, toSectionId?, complete? }], keepRollNumbers? }` |
| GET | `/promotions?branchId=` / POST `/promotions/:id/undo` | `students.enrolment.promote` |
| POST | `/students/import` | `students.student.import` + `.create` at the section's branch: `{ academicYearId, sectionId, dryRun?, rows }` |
| PUT | `/organization/admission-numbering` | `students.settings.update` for the whole organization: `{ mode: AUTOMATIC\|MANUAL, pattern? }` |
| GET / POST / PATCH / DELETE | `/document-types[/:id]` | view: `students.document.view`; change: `students.settings.update` for the whole organization |
| GET / POST / PATCH / DELETE | `/students/:id/documents[/:docId][/file]` | `students.document.view` / `.create` / `.update` / `.delete` |

## Rules (tested in `test/students.e2e-spec.ts`, `test/promotion.e2e-spec.ts`)

1. Nothing works unless the organization has the Students module.
2. Admission numbers are unique in the organization; MANUAL needs one, AUTOMATIC ignores a typed one.
3. **Placements:**
   - a placement is in a section (last level, in use) of the student's branch, in a year that isn't closed
   - at most one current placement per student
   - roll numbers are unique among the students currently in a section
4. A section or branch change is never earlier than the current placement; the old placement ends the day before.
5. A Branch admin sees, admits and changes only their branch's students; a branch change needs the permission at both branches.
6. Outgoing students can't change section or branch, aren't on registers or in promotion, and get no new portal login.
7. **Promotion:**
   - goes to a LATER year that isn't closed
   - students already placed in that year are left alone
   - old placements become PROMOTED (or COMPLETED for those who complete)
8. Import is all or nothing: with any problem (or `dryRun`) nothing is saved; at most 2000 rows.
9. Another organization sees none of it; every change goes to the audit log with its branch.

## Screens (web app → Students)

- **Students:** Current / Outgoing tabs; filters for search, branch, year, and any part of the structure
- **Admit student:** branch and section chosen step by step
- **Promote**
- **Import students:** where, then the file
- **Student settings:** admission numbers, document types
- **A student's page:**
  - current section, with change section / change branch
  - timeline
  - mark as left / re-admit
  - profile, guardians, documents, attendance, portal logins

## Later

Bulk upload of documents, photos on the profile, documents for staff.

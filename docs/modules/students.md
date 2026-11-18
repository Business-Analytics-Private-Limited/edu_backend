# Module: students (admission, profile, placements, outgoing students, promotion, import, top rankers, documents)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/students/` |
| Tables | `students`, `student_status_changes`, `guardians`, `student_guardians`, `enrolments`, `admission_sequences`, `promotion_runs`, `import_runs`, `document_types`, `student_documents`; `organizations.admission_numbering`, `admission_no_pattern` |
| Decisions | ADR-0020, ADR-0030 (branches, placements as periods, outgoing students, import into a section, admission numbering), ADR-0031 (details and their rules, sensitive details, import records, top rankers), ADR-0034 (promote chosen students or a whole section; add a missing next-year section from the promotion page) |
| Switched on by | the super admin, per organization (module key `students`, needs `academic`) |

## In plain words

- **Admission ("Add student"):**
  - a student is admitted at a **branch**; **required: full name, date of birth, gender, admission date** (and the admission number when numbers are typed)
  - optionally, right away, a **section** for an academic year, and father / mother / guardian (name, phone, occupation)
  - **every other detail is optional** (ADR-0031): alternate phone, email, address, permanent address, area, Aadhaar, category, sub-caste, day scholar / hosteller, bus and pickup point, previous school, board, hall ticket no, percentage, grade, admission test no and marks, medical condition, remarks, top ranker and learner level
  - **lateral entry** (joining straight into Senior or 2nd Year) is normal: fill in the previous education
- **Strict rules, one place** (`student-rules.ts`, ADR-0031): the form, editing and every import row are checked the same way, e.g. names (letters, spaces, `. ' -`), mobiles (10 digits, 6–9 first; `+91` and spaces cleaned), Aadhaar (12 digits with a valid check digit, unique in the organization), percentage 0–100, the student 3 to 30 years old at admission, a pickup point when the bus is used. The web app checks them in the browser too.
- **Sensitive details:** Aadhaar, category, sub-caste and medical condition only with `students.sensitive.view`; otherwise the Aadhaar is masked (XXXX-XXXX-1234) and the rest hidden. Never written to the audit log.
- **Admission numbers**, as the organization admin decides:
  - **Automatic:** from the organization's pattern, e.g. `{CODE}{YY}{SEQ:4}` → *SVJC260001*. `{BRANCH}` gives each branch its own counter, e.g. `{CODE}/{BRANCH}/{SEQ:4}`. A typed number is ignored.
  - **Manual:** typed in the form and the import sheet, required.
  - Unique in the whole organization either way.
- **Placements (enrolments) are periods:**
  - a student is in **one section of one branch**, in an academic year, from a date until a date
  - **SHUFFLE** (one student, from the profile): another section (e.g. Regular → JEE Mains) or another branch and a section there; it ends the current placement the day before and starts a new one, with the date and a reason (the timeline shows "Shuffled")
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
  - **a whole section, or only the students ticked**: all are ticked at first; untick students to hold them back (they stay in the old year, and can be promoted later)
  - the user can change any target and keep roll numbers (a roll number already taken in the new section is left empty)
  - the targets are grouped by year: the **next year** first, then the **same year** (to repeat it), then any others; **Complete** last
  - when the branch has no section to match in the next year yet (e.g. no Senior sections), the card says so and offers **Add section** there, pre-filled with the same name and code (needs `academic.structure.create` at the branch; others are told who can); once added, it is the suggestion
  - the old placement ends on the last day of the "from" year (or the day it began, if that is later); an undo makes it current again
  - every applied promotion is recorded and can be **undone** once, all or nothing, while nothing changed since
- **Import:**
  - choose **branch → year → the structure level by level → section** on the screen
  - the CSV has only the students' own columns (no `admissionNo` column with automatic numbers), and every row goes into that section
  - **Check the file** saves nothing; **Import students** saves the **valid rows** and **excludes** the others with their reasons, including duplicates (admission number or Aadhaar already used, same name + date of birth + phone as a student on record or an earlier row, roll number taken)
  - each import makes an **import record** (IMP-0001 …): who, when, where, rows / imported / excluded, the excluded rows with reasons. The file is not kept; the excluded rows can be downloaded to fix and import again. **No undo**: correct a student on their own page
- **Top rankers:** a student marked as top ranker, with a learner level (Expert, Medium, Slow), listed on the Top rankers page
- **Documents:**
  - the organization lists the document types it collects (required? visible to parents?)
  - staff upload, download, verify or reject, and delete
  - see [files.md](files.md) and ADR-0023

## Endpoints (`/api/v1`)

| Method | Path | Permission (at the student's branch) |
|---|---|---|
| GET | `/students?search=&branchId=&classId=&academicYearId=&show=current\|outgoing\|all&status=&topRanker=true&learnerLevel=&page=` | `students.student.view`: only students in reach; `classId` = any class of the structure (or one section), in every branch |
| POST | `/students` | `students.student.create`: admission (`branchId`, `enrolment`, `guardians` optional) |
| GET | `/students/:id` | `students.student.view`: profile, guardians, placements (with `section` label), status history, `importedFrom`; sensitive details only with `students.sensitive.view` (`sensitiveVisible`) |
| PATCH | `/students/:id` | `students.student.update`: any detail; `null` clears an optional one |
| POST | `/students/:id/leave` | `students.student.update`: `{ status, effectiveOn, reason?, destination? }` → outgoing |
| POST | `/students/:id/readmit` | `students.student.update`: `{ effectiveOn, reason? }` |
| POST | `/students/:id/change-section` | `students.enrolment.transfer`: `{ classId, effectiveOn, reason?, rollNo? }` |
| POST | `/students/:id/change-branch` | `students.enrolment.transfer` at BOTH branches: `{ branchId, classId, effectiveOn, reason?, rollNo? }` |
| DELETE | `/students/:id` | `students.student.delete`: mistakes only (not with attendance on record) |
| GET | `/guardians?phone=` | `students.student.view`: guardians on record, to link a sibling |
| POST / PATCH / DELETE | `/students/:id/guardians[/:guardianId]` | `students.student.update` |
| POST | `/students/:id/enrolments` | `students.student.update`: place a current student without a section `{ academicYearId, classId, rollNo? }` |
| PATCH | `/students/:id/enrolments/:enrolmentId` | `students.student.update`: `{ rollNo }` |
| GET | `/promotions/preview?branchId=&fromYearId=&toYearId=` | `students.enrolment.promote`: per section its students, the suggestion, its year and next year (`yearClassId`, `nextYearClassId`), and `nextPlace` (where the matching next-year section would go, when it is missing); the target sections with their year (`yearClassId`, `yearLabel`) |
| POST | `/promotions` | `students.enrolment.promote`: `{ branchId, fromYearId, toYearId, mapping: [{ fromSectionId, toSectionId?, complete?, studentIds? }], keepRollNumbers? }` (`studentIds`: only these students of the section) |
| GET | `/promotions?branchId=` / POST `/promotions/:id/undo` | `students.enrolment.promote` |
| POST | `/students/import` | `students.student.import` + `.create` at the section's branch: `{ academicYearId, sectionId, fileName?, dryRun?, rows }` → `{ total, importable, imported, excluded[], run }` |
| GET | `/students/imports?branchId=` / `/students/imports/:id` | `students.student.import` at the branch: import records; one record with its excluded rows and the students it admitted (with missing details) |
| PUT | `/organization/admission-numbering` | `students.settings.update` for the whole organization: `{ mode: AUTOMATIC\|MANUAL, pattern? }` |
| GET / POST / PATCH / DELETE | `/document-types[/:id]` | view: `students.document.view`; change: `students.settings.update` for the whole organization |
| GET / POST / PATCH / DELETE | `/students/:id/documents[/:docId][/file]` | `students.document.view` / `.create` / `.update` / `.delete` |

## Rules (tested in `test/students.e2e-spec.ts`, `test/promotion.e2e-spec.ts`)

1. Nothing works unless the organization has the Students module.
2. Admission numbers are unique in the organization; MANUAL needs one, AUTOMATIC ignores a typed one. Aadhaar numbers are unique too. Every detail follows `student-rules.ts`; sensitive details are hidden without `students.sensitive.view` and never logged.
3. **Placements:**
   - a placement is in a section (last level, in use) of the student's branch, in a year that isn't closed
   - at most one current placement per student
   - roll numbers are unique among the students currently in a section (a clash says who has it)
4. A section or branch change is never earlier than the current placement; the old placement ends the day before.
5. A Branch admin sees, admits and changes only their branch's students; a branch change needs the permission at both branches.
6. Outgoing students can't change section or branch, aren't on registers or in promotion, and get no new portal login.
7. **Promotion:**
   - goes to a LATER year that isn't closed
   - students already placed in that year are left alone
   - old placements become PROMOTED (or COMPLETED for those who complete) and end on the last day of the "from" year; an undo makes them current again
8. Import saves the valid rows and excludes the rest with reasons (a dry run saves nothing); duplicates are excluded; at most 2000 rows; each import is recorded (IMP-0001 …) and can't be undone.
9. Another organization sees none of it; every change goes to the audit log with its branch.

## Screens (web app → Students)

- **Students:** Current / Outgoing tabs; filters for search, branch, year, any part of the structure, and a section of the chosen branch; **Add student** and **Import students** buttons; on each row a view (eye) and edit (pencil) icon
- **Add student:** branch and section chosen step by step; every detail, grouped; father / mother / guardian
- **Edit student** (`/students/:id/edit`): the same fields
- **Top rankers:** tabs All / Expert / Medium learner / Slow learner, with the usual filters
- **Promote:** branch, from year (the current one) and to year (the next), shown as soon as one changes; one card per section with its students to tick (all at first), the target section suggested and the list grouped by year; **Add section** on a card whose next-year section is missing; a sticky bar with the count; recent promotions with Undo
- **Import students:** where, then the file; the admission-number switch; the column list. **Import history** and one import's page (excluded rows, imported students with missing details, download excluded rows)
- **Student settings:** admission numbers, document types
- **A student's page:**
  - profile: every detail read-only, with **Edit**; "from import IMP-0001, row 2"
  - current section, with **Shuffle** (another section or branch, in a slide-in panel)
  - timeline
  - mark as left / re-admit
  - profile, guardians, documents, attendance, portal logins

## Later

Bulk upload of documents, photos on the profile, documents for staff.

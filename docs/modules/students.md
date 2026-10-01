# Module: students (admission, profile, guardians, sections)

| | |
|---|---|
| Status | **Built (part 1):** admission, profile, status history, guardians, sections per year. **Next:** promotion / shuffle, campus transfer, documents, numbering, import |
| Code | `src/modules/students/` |
| Tables | `students`, `student_status_changes`, `guardians`, `student_guardians`, `enrolments` |
| Decisions | ADR-0020 (and ADR-0018 places, ADR-0019 academic structure) |
| Switched on by | the super admin, per organization (module key `students`, needs `academic`) |

## In plain words

- **Admission:** a student is admitted to a **campus** with an admission number (unique in the institution), name, date of birth, gender and contacts; optionally right away a **batch**, a **section** for an academic year, and a parent.
- **Status:** Active → Transferred / Discontinued / Alumni, each with a date and reason, kept as history. Leaving ends the current section.
- **Guardians:** father, mother, guardian; one is the main contact. Siblings share the same guardian record (find them by phone).
- **Sections:** one per academic year — a class of the institution's last level on the student's campus (e.g. *1st year › MPC › Section A*), with a roll number.

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

## Rules (tested in `test/students.e2e-spec.ts`)

1. Nothing works unless the organization has the Students module.
2. Admission numbers are unique in the institution.
3. A section must be a class of the last level, in use, on the student's campus; the year must be the institution's and not closed; one section per student per year; roll numbers unique per section and year.
4. A Campus admin sees, admits and changes only their campus's students; deleting needs `students.student.delete` (not in Campus admin by default).
5. A guardian can be linked to several students; removing the last link removes the guardian.
6. Another organization sees none of it; every change goes to the audit log with its campus.

## Screens (web app → Students)

Students (search, campus and status filters) · Admit student · a student's page (profile, parents / guardians, sections per year with move and roll no, status and history).

## Next (part 2)

Promotion and shuffle of whole batches / sections to the next year (preview, then apply), moving a student to another campus, documents (with file storage), automatic admission numbers, import from Excel / CSV, parent and student logins (portal).

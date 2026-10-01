# Module: portal (parents and students)

| | |
|---|---|
| Status | **Built (part 1):** parent and student logins, their students' details and attendance |
| Code | `src/modules/portal/`; logins in `users` (`kind`, `guardian_id`, `student_id`) |
| Decisions | ADR-0022 |
| Switched on by | the super admin, per organization (module key `portal`, needs `students`) |

## In plain words

- Staff give a **student** or a **parent** a login from the student's page (email + temporary password). A parent's login belongs to the guardian record, so it covers **all their children**.
- Parents and students log in on the same login page and land in the **portal**: their children (or themselves) with school, campus, section, batch, and **attendance** (this month and the last 30 days, with the days absent and remarks).
- Portal logins have **no staff access at all**; staff pages send them to the portal.

## Endpoints (`/api/v1`)

| Method | Path | Who |
|---|---|---|
| GET | `/portal/me` | portal logins — name, kind, their students |
| GET | `/portal/students/:id` | portal logins — only a linked student (else 404) |
| GET | `/portal/students/:id/attendance?from=&to=` | portal logins, with the Attendance module |
| POST | `/students/:id/portal-access` | staff, `students.student.update` at the student's campus — `{ for: STUDENT \| GUARDIAN, guardianId?, email, password }` |
| DELETE | `/students/:id/portal-access/:userId` | same |

## Rules (tested in `test/portal.e2e-spec.ts`)

1. Logins only with the portal module; switching it off closes the portal at once.
2. One login per student and per guardian; a guardian must be linked to the student.
3. A parent sees exactly their guardian record's children; a student only themselves; anything else is 404.
4. Portal logins are refused by every staff endpoint; staff are refused by the portal; staff user lists don't show portal logins.
5. Removing a login stops it at once.

## Later

Login by phone with a one-time code (SMS provider), consent for minors (DPDP), notices, fees and marks in the portal, a mobile app.

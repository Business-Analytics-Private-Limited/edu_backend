# ADR-0020: Students — admission at a campus, guardians shared by siblings, one section per year

Status: Accepted
Date: 2026-10-01

Builds on ADR-0018 (places) and ADR-0019 (academic structure). Simplifies docs/modules/students.md (written before ADR-0015).

## Context

Every later module (attendance, exams, fees, the parent portal) needs to know who the students are, where they study, who their parents are, and which section they are in each year. The structure must work for any institution's class levels (ADR-0019).

## Decision

- **A student belongs to an institution and studies at one campus** (`students.campus_id`). The campus is the student's place: a Campus admin sees and manages their campus's students, a Principal their institution's (`reachOf`, `assertCan`).
- **Admission number** unique in the institution, entered by hand for now (automatic numbering later, per institution).
- **Status** (Active, Transferred, Discontinued, Alumni) with a dated **history** and reason (`student_status_changes`). Leaving closes the active enrolment. Deleting is only for mistakes; normal exits use a status.
- **Guardians are people on record once** (`guardians`) linked to students (`student_guardians`, relation, primary). Siblings share the same guardian record; search by phone to link. A guardian without children left is removed.
- **Enrolment** = the student's **section** (a class of the institution's LAST level, on the student's campus, in use) in an **academic year** that isn't closed; one per student per year; roll numbers unique in a section per year. Moving between sections of the same campus needs `students.enrolment.transfer`.
- The **batch** (ADR-0019) is kept on the student.
- Only for organizations with the Students module (which needs Academic).

## Consequences

- Attendance, exams and the portal can rely on "student → section in year → campus", whatever the institution calls its levels.
- Promotion and shuffle (2026-10-01): per campus, preview with suggestions (next top-level class, same path by code; finish after the last), then apply; shuffle moves ticked students within a year.
- Campus transfer, automatic admission numbers (pattern per institution, counters in `admission_sequences`) and CSV import (check every row, then all or nothing) added 2026-10-01.
- Next: undo of a promotion, documents (needs file storage), parent / student logins (portal).

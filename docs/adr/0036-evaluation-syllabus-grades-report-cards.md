# ADR-0036: Evaluation, part 2: syllabus, grades, report cards, overviews, portal results

Status: Accepted
Date: 2026-11-27

Builds on ADR-0035 (part 1). Nothing of part 1 changes, except that an exam may name a grading scheme and its subjects may tick chapters.

## Context

The project owner listed what part 1 left open:

1. a syllabus: chapters per subject, ticked on each exam;
2. grades: marks to A+ / A / B … or a GPA, set by each organization;
3. a report card PDF per student, with the organization's logo;
4. report cards in bulk for a section, a batch or a campus (branch);
5. overviews: class, batch, campus and organization (averages, pass %, toppers, weak subjects);
6. results in the parent and student portal.

## Decision

### 1. Syllabus (Academic module)

- `chapters`: the chapters of a subject, in teaching order; names unique in the subject; switched off instead of deleted once an exam has ticked them.
- Managed with `academic.subject.update` (whole organization), read with `academic.subject.view`. Endpoints under `/subjects/:id/chapters` and `/chapters/:id`.
- An exam subject stores the ticked chapters as **plain ids** (`exam_subjects.chapter_ids`), like every other module's record in the Evaluation tables. A chapter must belong to that subject and be in use, unless the exam had already ticked it.
- Deleting a chapter checks `exam_subjects` with a query. This is the one place where Academic reads an Evaluation table; when the modules become services it becomes an API call or the check moves to "switch off only".

### 2. Grading schemes (Evaluation module)

- A scheme is a list of bands "from this percentage up" with a grade, an optional grade point and an optional remark. One band starts at 0 %. Grades and starting percentages are unique in a scheme.
- At most one scheme is the organization's **default** (the first one created becomes it). An exam may name its own scheme; otherwise it uses the default; with no scheme there are no grades.
- **Per subject:** the grade of the subject's percentage; ABSENT counts as 0 %; EXEMPT has no grade.
- **Overall:** the grade of the overall percentage (only when the marks are complete).
- **GPA:** the average grade point of the graded subjects, only when every band of the scheme has a grade point.
- Pass / fail stays as in part 1 (pass marks per subject). Grades don't change the result.
- Managed with `evaluation.settings.update`, read with `evaluation.exam.view`. A scheme that exams use can't be deleted.

### 3 and 4. Report cards

- `report_card_settings` per organization: title, a header line (address, affiliation), up to four signature labels, a footer note, and a logo (PNG or JPG, kept through the Files module, stored as a plain id).
- The PDF is drawn on the server with **pdfkit** (pure JavaScript, no browser needed): one A4 page per student with the logo and name, the exam, the student's details, the subjects (maximum, pass, marks, grade; failed marks in red), total, percentage, result, grade, GPA, ranks, the grade key and the signature lines.
- One student: `GET /exams/:id/report-cards/:studentId`, with `evaluation.marks.view` at the student's branch.
- In bulk, one PDF: `GET /exams/:id/report-cards?sectionId=&branchId=`. Without a section or branch, every section the user may see. A "batch" is the exam's part of the structure (ADR-0035), so a bulk print of an exam for "Junior › MPC" is the batch.
- Printing in bulk is written to the audit log.
- Cards use the same calculation as the results screen (`computeResults`), so marks, ranks and grades always agree.

### 5. Overviews

- `GET /exams/:id/overview`: for everything the user may see, and by branch (campus), by group (the level under the year: MPC, BiPC, a course) and by section (class). Each with students, passed, failed, incomplete, pass %, average %, highest % and the top three. Per subject: average % (ABSENT = 0), pass %, highest mark. The three weakest subjects (lowest pass %). The grade spread.
- `GET /exam-overview?academicYearId=`: the year's exams side by side (the organization view over time).
- Only sections at branches where the user has `evaluation.marks.view` count. An organization-wide user sees the whole exam.

### 6. Portal

- `GET /portal/students/:id/exams`, `/exams/:examId` and `/exams/:examId/report-card`, for a parent or student linked to the student (ADR-0022), with the Evaluation module on.
- Only **LOCKED** exams are shown: locking is how staff publish results. An exam that is unlocked again disappears from the portal until it is locked.
- The portal shows the section rank, not the rank in the whole exam.

## Consequences

- New tables: `chapters` (Academic), `grading_schemes`, `grading_bands`, `report_card_settings` (Evaluation), all with `organization_id` and row security. New columns: `exam_subjects.chapter_ids`, `exams.grading_scheme_id`.
- No new permissions: `evaluation.settings.*` now also covers grading schemes and report card settings (its label says so).
- New dependency: `pdfkit`. Its built-in Helvetica font covers English. Names in Telugu or Hindi need a Unicode font added to the PDF later.
- The portal module now depends on the Evaluation module (it imports `ReportCardsService`). When the modules become services, the portal calls the Evaluation service's API instead.

## Alternatives considered

- **HTML to PDF with a headless browser:** nicer layouts, but a browser on the server is heavy and hard to host. pdfkit is enough for a table and a few lines.
- **Grades stored with the marks:** they would go stale when a scheme changes. Computing them when asked keeps one source of truth.
- **A "published" flag separate from locking:** one more step for staff. Locking already means "final"; if publishing needs to differ later, a flag can be added.

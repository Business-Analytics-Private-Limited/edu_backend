# Module: evaluation (exam types, exams with subjects and marks, marks upload, results)

| | |
|---|---|
| Status | **Built**: part 1 (ADR-0035) and part 2 (ADR-0036): syllabus, grades, report cards, overviews, portal results |
| Code | `src/modules/evaluation/` |
| Tables | `exam_types`, `exams`, `exam_subjects`, `exam_marks`, `marks_uploads`, `grading_schemes`, `grading_bands`, `report_card_settings` (and `chapters` in Academic) |
| Decisions | [ADR-0035](../adr/0035-evaluation-exams-and-marks.md), [ADR-0036](../adr/0036-evaluation-syllabus-grades-report-cards.md) |
| Switched on by | the super admin, per organization (module key `evaluation`, needs `academic` and `students`) |

## In plain words

- **Exam types:** the organization's kinds of exam (Weekly test, Quarterly, Half-yearly, Grand test …), each with a short code. A type in use can be switched off but not deleted.
- **An exam:**
  - has a type, an academic year, a name (unique in the year) and dates inside the year;
  - is **for a part of the structure**: a year (all its sections), a group, a stream, or one section;
  - is held at **one branch or every branch**;
  - has its **subjects**, each with maximum and pass marks, an optional date and an optional **portion** ("Ch 1-4, Trigonometry").
- **Each section has its own subjects:** those attached to it or to a class above it (Academic → subjects of a class). The New exam form offers the chosen part's subjects, ticked, with where each is attached. A section with no subjects attached takes every subject of the exam; a subject no section has attached is for every section.
- **Who takes part:** the students placed in the exam's sections during the exam dates. A student who changed section counts in the latest one. Each student is expected to have marks in their section's subjects (plus any subject they already have a mark in).
- **Marks:** per student and subject: a number (PRESENT), ABSENT, or EXEMPT (left out of the totals). Each mark keeps the student's section and branch at the time.
  - **By hand:** a section's grid.
  - **By CSV:** `admissionNo` plus one column per subject code; `AB` absent, `EX` exempt, blank or `-` keeps the mark (the template writes `-` for a subject the section doesn't have). Check first, then upload. Valid rows are saved; the rest are listed with reasons in the upload record (MKS-0001 …).
- **Locking:** a locked exam takes no marks until it is unlocked.
- **Results:** total, percentage, PASS / FAIL / INCOMPLETE, and ranks in the section and the whole exam (1, 2, 2, 4 for ties).

## API (`/api/v1`)

| Method | Path | Permission |
|---|---|---|
| GET | `/exam-types` | `evaluation.exam.view` |
| POST / PATCH / DELETE | `/exam-types[/:id]` | `evaluation.settings.update` for the whole organization |
| GET | `/exams?academicYearId=&branchId=&examTypeId=&status=` | `evaluation.exam.view` |
| GET | `/exams/subject-options?classId=&branchId=` | `evaluation.exam.create`: the chosen part's subjects (`sections` having each, `attachedTo`), `otherSubjects`, `sectionsWithoutSubjects` |
| POST | `/exams` | `evaluation.exam.create`: `{ examTypeId, academicYearId, name, classId, branchId?, startsOn, endsOn, subjects: [{ subjectId, maxMarks, passMarks, examDate?, portion? }] }`; for every branch it needs the permission for the whole organization |
| GET | `/exams/:id` | `evaluation.exam.view`: subjects, sections with students and marks entered |
| PATCH | `/exams/:id` | `evaluation.exam.update`: name, type, dates, `subjects` (replaces the list; a subject with marks stays) |
| DELETE | `/exams/:id` | `evaluation.exam.delete`: only without marks |
| POST | `/exams/:id/lock`, `/exams/:id/unlock` | `evaluation.exam.update` |
| GET | `/exams/:id/marks?sectionId=` | `evaluation.marks.view` at the section's branch |
| PUT | `/exams/:id/marks` | `evaluation.marks.enter`: `{ sectionId, entries: [{ studentId, subjectId, status: PRESENT\|ABSENT\|EXEMPT\|CLEAR, marks? }] }` |
| POST | `/exams/:id/marks/upload` | `evaluation.marks.import`: `{ dryRun?, fileName?, rows: [{ heading: value }] }` → counts, rows left out with reasons, `upload` (MKS-0001) |
| GET | `/exams/:id/results?sectionId=` | `evaluation.marks.view` |
| GET | `/exams/:id/uploads`, `/marks-uploads/:id` | `evaluation.marks.view` |

## Rules (tested in `test/evaluation.e2e-spec.ts`)

1. **Checked when an exam is created or changed:**
   - the dates lie inside the academic year, and the year isn't closed;
   - pass marks are not above the maximum;
   - a subject's own date (if given) lies inside the exam's dates, also after the exam's dates change;
   - at least one active section takes part.
2. A subject with marks can't be removed from an exam, and its maximum can't go below a mark already entered. An exam with marks can't be deleted.
3. Marks need the permission at the student's or section's branch. In an upload, a row of another branch is left out with the reason.
4. A locked exam takes no marks.
5. **Results:**
   - over the student's subjects only (a subject the section doesn't have shows "n/a");
   - EXEMPT subjects don't count;
   - ABSENT, or below the pass marks, in a subject means FAIL;
   - a subject without marks means INCOMPLETE;
   - ranks are over all students of the exam with complete marks, so every screen shows the same rank.
6. Every change is in the audit log. Another organization sees none of it (row security on all five tables).
7. Students, sections, branches, years and subjects are stored as plain ids, so the module can become its own service (ADR-0024).

## Screens (web app → Evaluation)

- **Exams:** filters by year and type; New exam.
- **New exam**, in two steps:
  1. branch (or every branch) and "For" (a part of the structure or one section);
  2. type, year, name, dates, and that part's subjects (ticked) with maximum and pass marks, date and portion.
- **An exam:**
  - subjects;
  - every section with students and "marks in";
  - Enter marks, Upload marks, Results, Lock / Unlock, Delete (without marks);
  - the list of marks uploads.
- **Marks:** a section's grid (number, AB, EX; empty a box to remove a mark).
- **Upload marks:** download the template (the students, with marks so far), Check the file, Upload marks. The upload record lists the rows left out with their reasons.
- **Results:** summary (passed, failed, incomplete, average), each student's marks, total, %, result, ranks.
- **Exam types:** add, switch off, delete (unused).

## Part 2 (ADR-0036)

- **Syllabus:** each subject's chapters, in order (Academic → a subject → Chapters). An exam ticks the chapters it covers per subject. A ticked chapter can be switched off but not deleted.
- **Grades:** grading schemes ("from 90 % up: A+, grade point 10"). The first scheme is the default; an exam may choose another. Results show a grade per subject, an overall grade and a GPA (when every band has a grade point). ABSENT counts as 0 %; EXEMPT has no grade.
- **Report cards:** settings (title, header line, signatures, footer, logo); a PDF for one student, or one PDF for a section, a branch or everything the user may see.
- **Overviews:** an exam by branch, group and section, per subject, toppers, weakest subjects, grade spread; a year's exams side by side.
- **Portal:** parents and students see LOCKED exams only: marks, total, %, grade, result, section rank, and the report card PDF.

| Method | Path | Permission |
|---|---|---|
| GET / POST | `/subjects/:id/chapters` | `academic.subject.view` / `.update` |
| PUT | `/subjects/:id/chapters/order` | `academic.subject.update` |
| PATCH / DELETE | `/chapters/:id` | `academic.subject.update` (delete only if no exam ticked it) |
| GET | `/grading-schemes` | `evaluation.exam.view` |
| POST / PATCH / DELETE | `/grading-schemes[/:id]` | `evaluation.settings.update` (delete only if unused) |
| GET / PUT | `/report-card-settings` | `evaluation.exam.view` / `evaluation.settings.update` |
| GET / PUT / DELETE | `/report-card-settings/logo` | view / `evaluation.settings.update` (PNG or JPG, 5 MB) |
| GET | `/exams/:id/report-cards?sectionId=&branchId=` | `evaluation.marks.view` (PDF, only branches the user may see) |
| GET | `/exams/:id/report-cards/:studentId` | `evaluation.marks.view` at the student's branch (PDF) |
| GET | `/exams/:id/overview` | `evaluation.marks.view` |
| GET | `/exam-overview?academicYearId=` | `evaluation.marks.view` |
| GET | `/portal/students/:id/exams[/:examId[/report-card]]` | portal login linked to the student |

Rules tested in `test/evaluation-part2.e2e-spec.ts`.

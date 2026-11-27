# ADR-0035: Evaluation, part 1: exam types, exams with subjects, marks entry and CSV upload

Status: Accepted
Date: 2026-11-25

Adds the Evaluation module (v2 scope, "Exams and results"). Part 2 adds grading schemes, report cards and overviews on top of this.

## Context

The project owner asked for:

- **Exam types** (e.g. weekly test, quarterly, half-yearly, grand test) and exams that include **subjects with their marks**.
- Exams that apply to the organization **batch-wise**: to a part of the structure (a year, a group, a stream or one section) at one branch or at every branch.
- **Marks uploaded from a CSV file per exam**, matched by **admission number**.
- Data kept **per organization** (multi-tenant), and ready for the microservices plan (ADR-0024).

## Decision

### 1. Exam types

Each organization keeps its own list: name and short code (both unique), active or not. Examples: Weekly test (WT), Unit test (UT), Quarterly (Q), Half-yearly (HY), Pre-final (PF), Grand test (GT).

### 2. Exams apply to a part of the structure

- An exam has: a type, an academic year, a name (unique in the year), dates, and **the part of the structure it is for** (`class_id`): any node of the tree. Examples:
  - Junior (1st Year): every Junior section;
  - Junior › MPC › JEE Mains: that stream;
  - one section.
- **Branch:** one branch, or empty for **every branch**. The sections that take part are the active sections under that node, at that branch or at all of them.
- **Students who take part:** those placed in one of these sections during the exam (their placement in the exam's year overlaps the exam dates). A student who changed section keeps the latest one.
- This is what "batch-wise" means here: the batch is chosen by the structure node, the branch and the year. No extra "batch" table is needed.

### 3. Subjects with marks

- Each exam lists its subjects (from the organization's subjects), each with **maximum marks**, **pass marks**, an optional date and an optional **portion** (free text: what the exam covers, e.g. "Ch 1-4, Trigonometry").
- **Each section has its own subjects** (decided with the owner, 2026-11-25). A section has the subjects attached to it or to a class above it (Academic → subjects of a class). The New exam form offers the subjects of the chosen part, ticked, showing where each is attached ("1 of 10 sections: … › BiPC"); the organization's other subjects are folded away. A student is expected to have marks only in their section's subjects (plus any subject they already have a mark in). Two fallbacks keep half-finished set-ups working: a section with **no subjects attached** takes every subject of the exam, and a subject of the exam that **no section has attached** is for every section.
- A syllabus (chapters per subject, ticked per exam) is planned next, in the Academic module; the exam will store chapter ids as plain ids.
- Marks are stored per student and subject, with a status:
  - **PRESENT** with marks (0 to the maximum, at most two decimals);
  - **ABSENT**;
  - **EXEMPT** (left out of the totals).
- With every mark, the student's **section and branch at the time** are stored, so results stay right after promotions and shuffles.

### 4. Entering marks

- **By hand:** a section's grid (students × subjects), saved as one action.
- **CSV upload per exam:**
  - The template has the column `admissionNo`, then one column per subject code (e.g. `MAT`, `PHY`). Name, section and roll number columns may be there and are ignored.
  - Values: a number; `AB` or `A` = absent; `EX` = exempt; blank or `-` = leave as it is. So one subject teacher can upload just their column. The template writes `-` for a subject the student's section doesn't have; a mark there is left out with the reason.
  - **Check the file** saves nothing and lists what would be saved and what not. **Upload marks** saves the valid rows and records the upload (MKS-0001 …) with the rows left out and the reasons. This is the same pattern as the student import (ADR-0031).
  - A row is left out when:
    - the admission number is empty or unknown;
    - the student isn't in this exam;
    - the admission number appears twice in the file;
    - the user may not enter marks at the student's branch;
    - any value is not understood or is above the maximum.
- **Locking:** a locked exam takes no marks. Unlocking is allowed (with the permission), and every change is audited.

### 5. Results (basic)

Per student, computed when asked (not stored):
- the total and percentage over the subjects not exempt;
- **PASS**, **FAIL** (absent, or below pass marks in a subject), or **INCOMPLETE** (a subject without marks);
- the rank in the section and in the whole exam: standard competition ranking (1, 2, 2, 4), among complete results.

### 6. Multi-tenant storage, ready for its own service

- Every table has `organization_id` and **row-level security**, the same as every other organization table. One organization never sees another's exams or marks.
- Inside the module, tables use foreign keys (exam → type, subjects, marks, uploads). **Students, sections, branches, years and subjects of other modules are stored as plain ids, with no foreign keys to their tables.** The module can then move into its own service and database (ADR-0024) without changing its tables. The service checks those ids when it writes.

### 7. Permissions (new module `evaluation`, switched on by the super admin)

| Permission | Who has it by default |
|---|---|
| `evaluation.settings.view` / `.update` (exam types) | Organization admin; view also Principal, Director |
| `evaluation.exam.view` / `.create` / `.update` / `.delete` | Organization admin, Principal (at their branch); view for every staff role |
| `evaluation.marks.view` / `.enter` / `.import` | Organization admin, Principal, Branch admin; faculty view and enter; DTP operator view, enter and import |

- An exam for every branch needs the permission for the whole organization; an exam for one branch, the permission at that branch.
- Marks need the permission at the student's branch.

## Consequences

- Report cards, grading schemes, class, batch and campus overviews, and portal results (part 2) are built on these tables without changing them.
- Results are computed on request; for very large exams they can be cached later.
- Existing installations get the new permissions on the predefined roles through the migration, so no "reset to defaults" is needed.

## Alternatives considered

- **A separate "batch" table:** it would repeat what the structure tree, branch and year already say.
- **Marks as one JSON per student:** harder to check, to query per subject, and to rank.
- **Foreign keys to students and sections:** these would tie the module to the Students database and block the service split.

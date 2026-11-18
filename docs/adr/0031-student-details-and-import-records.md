# ADR-0031: More student details with strict rules, sensitive details, import records, top rankers

Status: Accepted
Date: 2026-10-13

Extends ADR-0020 and ADR-0030 (students, import, admission numbering).

## Context

The project owner compared EduPlatform with the student table of the system Ascent uses today (`student_list`) and asked for:

- **The details organizations actually collect,** none of them required except the basics: alternate phone, permanent address, area, Aadhaar, reservation category and sub-caste, day scholar / hosteller, bus and pickup point, previous board, hall ticket number, percentage and grade, admission test number and marks, medical condition, remarks, and the parents' occupations.
- **Strict validation on both sides:** the browser checks before sending, the server checks again, and a sheet row gets the same checks as the form.
- **Import only valid data:** the valid rows of a sheet are imported, and the invalid ones are left out with their reasons. Before, one bad row meant nothing was saved.
- **An import can be looked up later by its ID:** how many rows were imported, which were excluded and why. **No file storage** (it takes space), and **no undo** (it could be misused).
- **Top rankers:** a student is marked as a top ranker (active / inactive) with a learner level (Expert, Medium learner, Slow learner). Top rankers have their own page, filtered by branch, year (Junior / Senior …), section and level.
- **The admission-number switch on the import page:** with automatic numbers the template has no admission number column; with typed numbers it has one.
- **A form to add one student, and to edit one,** reachable from the students list (Add / Import buttons; view and edit icons on each row).

Not taken over from `student_list`: `Password` (passwords are never imported; portal logins are made fresh), `profile_pic`, `signature`, `attachment` (files: documents on the student's page), `BATCH4`, `BATCH`, `bid`, `type_code` (the year, group, stream and section of ADR-0030 replace batches), `student_type` (the student's status: current or outgoing), `selection_l1`, `selection_l2` (not used), and the bookkeeping columns (`S_NO`, `createdby`, `modifiedby`, `modifief_ts`: the audit log keeps them).

## Decision

### 1. Student details

New optional columns on `students`: `alternate_phone`, `permanent_address`, `area`, `aadhaar`, `category` (OC, BC_A … BC_E, SC, ST, EWS, OTHER), `sub_caste`, `residence` (DAY_SCHOLAR, HOSTELLER), `bus_facility`, `pickup_point`, `previous_board` (SSC, CBSE, ICSE, INTERMEDIATE, IB, OTHER), `hall_ticket_no`, `previous_percentage`, `previous_grade`, `admission_test_no`, `admission_test_marks`, `medical_condition`, `remarks`, `top_ranker`, `learner_level` (EXPERT, MEDIUM, SLOW). The free-text `previous_marks` is replaced by board, percentage and grade (any old text was moved into `remarks`). Parents keep using `guardians` (with occupation): father, mother and guardian.

**Required: full name, date of birth, gender, admission date, and the admission number when numbers are typed.** Everything else is optional.

### 2. One set of rules, used three times

`src/modules/students/student-rules.ts` holds every rule; `StudentDetailsDto` applies them with class-validator. The admission form, editing (`UpdateStudentDto`) and **each import row** (turned into the same DTO and validated with `validateSync`) use the same rules and the same messages. Rules across fields (`checkStudentRules`): the date of birth before the admission date, the student 3 to 30 years old at admission, a pickup point when the bus is used.

Examples: names (letters, spaces, `. ' -`, 2–100); mobile numbers (10 digits starting 6–9, `+91` and spaces are cleaned); Aadhaar (12 digits, not starting 0 or 1, valid Verhoeff check digit, unique in the organization); percentage 0–100; marks 0–1000.

The web app checks the same rules in the browser (`apps/web/lib/student-rules.ts`: HTML patterns, the Aadhaar check digit, a pickup point when the bus is ticked). The server decides.

### 3. Sensitive details

Aadhaar, category, sub-caste and medical condition are only shown with the new permission **`students.sensitive.view`** ("Sensitive student details"). Without it, the Aadhaar is masked (`XXXX-XXXX-1234`) and the others are empty, on the student's page, in edit forms and in import records. Their values are never written to the audit log ("(changed)" only). Branch admin, Principal and Director have it; faculty and DTP operators don't. Data entry (admission, import) doesn't need it.

### 4. Import: valid rows in, invalid rows out, and a record

- Each row is turned into values (`"BC-A"` → BC_A, `"yes"` → true, `01/06/2026` → a date) and checked with the rules above.
- A row is **excluded** when it breaks a rule or would be a **duplicate**: an admission number or Aadhaar already used (or twice in the sheet), a roll number taken in the section, or the same name and date of birth as a student on record (or an earlier row) with a phone in common, or no phones to tell them apart.
- **Check the file** (dry run) saves nothing and lists what would be imported and what excluded.
- **Import students** saves the valid rows in one transaction and writes an **import record** (`import_runs`, shown as IMP-0001, IMP-0002 … per organization): branch, year, section, file name, who and when, rows in the sheet / imported / excluded, and the excluded rows with their reasons and values. Students keep `import_run_id` and `import_row` ("from import IMP-0001, row 2").
- The **file itself is not kept.** The excluded rows can be downloaded as a CSV (same columns, plus the reason) to fix and import again.
- **No undo.** A wrong student is corrected on their own page (edit, change section, mark as left), or deleted if it is a mistake.
- If no row is valid, nothing is saved and no record is made.

Endpoints: `GET /students/imports` and `GET /students/imports/:id` (`students.student.import` at the branch).

### 5. Top rankers

`top_ranker` (active / inactive) and `learner_level` are set on Edit student or in the import sheet. `GET /students?topRanker=true&learnerLevel=EXPERT` filters them; the web app's **Top rankers** page has a tab per level and the usual filters (branch, year, structure, section).

### 6. Admission numbers on the import page

The automatic / typed switch (ADR-0030) is also on the import page. The template and the column list follow it: no `admissionNo` column with automatic numbers.

## Consequences

- One place to change a rule; the import can't drift from the form.
- A sheet with a few bad rows still brings in the good ones; the office fixes only the excluded rows.
- Import records stay small (only excluded rows are stored, as text).
- Existing predefined roles in a database keep their stored permissions: the super admin uses **Reset to EduPlatform defaults** on Branch admin and Principal for them to get `students.sensitive.view` (Director gets every view permission when reset too).
- Stricter names and phones: data typed before (e.g. landline numbers) is only checked again when it is edited.

## Alternatives considered

- **Keep all-or-nothing imports:** safe, but the owner wants the valid rows in and the rest listed.
- **Store the uploaded files:** answers "what exactly was uploaded", but costs storage and keeps personal data twice; the record with the excluded rows answers the owner's questions.
- **Undo an import:** easy to misuse; corrections happen per student.
- **Separate validation code for the import:** would drift from the form; one DTO is used for both.

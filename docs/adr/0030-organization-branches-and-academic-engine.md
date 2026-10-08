# ADR-0030: Organization → Branches, and one academic engine shaped by the organization's type

Status: Accepted
Date: 2026-10-08

Replaces ADR-0018 (places: organization / institution / campus), ADR-0025 (institutions by the super admin) and the place part of ADR-0026. Replaces the class levels and batches of ADR-0019, and changes promotion, import and admission numbering of ADR-0020. Extends ADR-0029: the super admin can now create predefined roles too.

## Context

The project owner reviewed the product with real organizations (school groups, junior colleges with IIT/JEE/NEET coaching, degree and engineering colleges):

- **"Institution" and "Campus" are the same thing to them: a branch.** Ascent Classes' four "institutions" (Dwarakanagar, NAD, Madhurawada, Aslimetta) are locations.
- **An organization is one kind of institution:** School, Intermediate, Degree or Engineering. A management that runs a school and a junior college uses two organizations. Coaching (IIT, JEE, NEET) is not a separate kind: it is Intermediate with streams.
- **The academic structure differs by kind,** but must be one configurable engine, not four hard-coded workflows. Fixed parts are built in; organizations choose the rest.
- **Promotion, students who leave, students who change section or branch, and lateral entry** must keep the full history.
- **Import** goes into one chosen section at a time. **Admission numbers** are automatic or typed, as the organization admin decides.

## Decision

### 1. Places: Organization → Branch

```
Super admin ─ creates organizations, their branches and each organization's first admin
  Organization (type: SCHOOL | INTERMEDIATE | DEGREE | ENGINEERING; code, e.g. "SVJC")
    Branch (a location, e.g. "KPHB"; code unique in the organization)
```

- **Only the super admin adds, deactivates, activates and deletes branches.** The organization can view them and rename them (`platform.branch.view`, `platform.branch.update`).
- **A role is given at the whole organization or at one branch** (`user_roles.branch_id`, empty = whole organization).
- **Settings that belonged to an institution now belong to the organization:**
  - academic years, the academic structure, subjects and document types
  - weekly off days, time zone, attendance correction window
  - admission numbering
- **Holidays** are for the whole organization or for one branch.
- **ADR-0026 still applies to branches:** an inactive branch keeps its records, nothing new happens there, and roles given there stop working.

### 2. The academic engine

**Levels are fixed by the type.** Their names can be renamed (`organizations.level_names`):

| Type | Levels (top → section) | Year level |
|---|---|---|
| School | Class → Section | Class |
| Intermediate | Year → Group → Stream → Section | Year |
| Degree, Engineering | Course → Specialization → Year → Section | Year |

**The structure is one tree of classes:**
- Everything above Section belongs to the **whole organization** (`classes.branch_id` empty).
- **Sections belong to a branch.** A section sits under a node of the level just above it.
- Students are always placed in a section.

**Built in (`src/modules/academic/presets.ts`):**
- **School:** a class list from Nursery, LKG and UKG to Class 10. The organization ticks the classes it runs.
- **Intermediate:**
  - The years **Junior → Senior** and **Long Term**. Long Term is for students who already finished Intermediate (e.g. NEET repeaters); it has no promotion and only long-term streams.
  - The groups **MPC, BiPC, CEC, HEC**. The organization switches on the ones it uses.
  - A built-in stream **Regular (IPE)** in every group, for students without coaching.
- **Degree / Engineering:** the organization adds courses (B.Tech) and specializations (CSE, ECE), with the number of years (3 or 4). The years "1st Year … Nth Year" are created for it.

**Chosen by the organization:**
- Its **streams** (IIT, JEE Mains, NEET, NEET Long Term…). Each belongs to one group, and is marked long-term or not. Sections are created *inside* a stream.
- **Sections** per branch.

**Progression** lives on the year-level nodes (`classes.next_class_id`):
- Class 9 → Class 10, Junior → Senior, 1st Year → 2nd Year.
- **Empty = the student completes** after that year: Class 10, Senior, Long Term, the final year.
- Presets set this; the organization admin can change it.

### 3. Academic years

- **One set of academic years per organization,** shared by all branches. Dates don't overlap, and at most one is active.

### 4. Enrolments are placement periods

- An enrolment = a student in **one section of one branch**, in one academic year, **from** `enrolled_on` **until** `ended_on` (empty = still there, or until the year's end).
- **Changing section, or changing branch, never overwrites:**
  - the old enrolment ends (status MOVED, with the date)
  - a new one starts, with the date and reason
  - attendance before the date stays with the old section
- At most one ACTIVE enrolment per student (partial unique index).
- **The register of a section on a day** = enrolments in that section whose period covers that day.

### 5. Students: current and outgoing

- **Status:** ACTIVE (current), or **outgoing**: COMPLETED (finished the final year), TRANSFERRED (took a TC), DISCONTINUED (dropped out).
- **Outgoing students:**
  - are hidden from current lists, registers, promotion and dashboards
  - are kept in full, readable, and listed under **Outgoing**
  - lose their portal login
  - can be **re-admitted**
- Leaving records the date, reason and, optionally, where they went.
- **Section change, branch change and leaving are done one student at a time, from the profile.** The bulk "move students" page is removed.
- Year-end **promotion** stays a per-branch action for all students at once.
- **Lateral entry:** admitting a student straight into a later year (e.g. Senior) is normal. Previous school/college and marks are optional profile fields.
- **The profile shows a timeline:** admissions, enrolments with their periods, status changes.

### 6. Promotion (per branch, from one year to the next)

- **The suggested target for a section:**
  1. take the next node of its year-level ancestor
  2. follow the same codes below it
  3. pick the section with the same code in the same branch
- **No next node** → the students complete.
- **No match** → the user chooses.
- History and undo work as before (ADR-0020).

### 7. Import

The user chooses **branch → academic year → (structure, level by level) → section**, then uploads a sheet with only the students' own columns. Every row goes into that section. Rows are checked first, and nothing is saved unless every row is valid.

### 8. Admission numbers

The organization admin chooses (`students.settings.update` for the whole organization):

- **Automatic:**
  - Numbers come from the organization's pattern, e.g. `{CODE}{YY}{SEQ:4}` → SVJC260001.
  - `{BRANCH}` adds the branch code, and gives each branch its own counter.
  - Any number in the form or sheet is ignored.
- **Manual:** a number is required in the form and in each sheet row.
- **In both modes:**
  - a number is unique in the whole organization
  - changing the setting never renumbers existing students

### 9. Roles

- **The predefined roles:**

| Role | Works at |
|---|---|
| Organization admin | whole organization |
| Director | whole organization: sees everything, with filters by branch / class / group / stream / section |
| Principal | a branch |
| **Branch admin** (was Campus admin) | a branch |
| Senior faculty, Junior faculty, DTP operator | a branch |
| Parent, Student | portal |

- Someone who is both Principal and Branch admin gets both roles.
- **The super admin can create more predefined roles** (with basic permissions). A new one is copied into every organization.
- Organizations change their copies for themselves only (ADR-0029). Built-in roles can't be deleted; super-admin-created ones can, while nobody has them.

## Migration of existing data

There is one organization (Ascent Classes) with 4 institutions, no campuses and no academic data except one academic year.

- Each campus becomes a branch, keeping its id. **An institution without campuses becomes a branch itself, keeping its id,** so audit entries and roles still point to the right place.
- Academic years move to the organization.
- Batches and class levels are removed (no students used them). The organization gets type INTERMEDIATE and a code derived from its slug.
- The migration **stops with an error** if it finds data it can't map safely: classes, students, enrolments, attendance, subjects, holidays, document types, or roles at an institution that has campuses.

## Consequences

- **Simpler:**
  - two places instead of three
  - one year list
  - the import sheet has no placement columns
  - promotion follows explicit "next" links instead of sibling order
- **A management with a school and a junior college has two organizations** (two logins, separate reports). An "organization group" can come later if needed.
- **The structure tree is organization-wide,** so the Director's filters (e.g. "Junior · MPC · JEE Mains") cover every branch at once.
- **The API changes:**
  - `/institutions` and `/campuses` become `/branches`
  - batches and class-level routes go
  - the import takes `sectionId`
  - the web app and console change with it

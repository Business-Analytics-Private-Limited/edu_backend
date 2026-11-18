# Module: academic (academic years, the academic structure, sections, subjects, calendar)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/academic/` (`presets.ts` = what each type gets, `structure.service.ts` = the engine, `class-tree.ts` = labels and lookups) |
| Tables | `academic_years`, `classes`, `branch_groups`, `subjects`, `class_subjects`, `holidays`; `organizations.level_names`, `organizations.weekly_off_days` |
| Decisions | ADR-0030 (one engine shaped by the organization's type; replaces ADR-0019), ADR-0032 (groups per branch), ADR-0033 (courses without specializations; editing courses) |
| Switched on by | the super admin, per organization (module key `academic`) |

## In plain words

- **Academic years:** one set for the whole organization, shared by every branch, e.g. "2026-27" from 1 June 2026 to 31 March 2027. One is **current** (active).
- **The academic structure:** one tree of classes per organization, shaped by its **type**:

  | Type | Levels (top → section) | Built in | The organization chooses |
  |---|---|---|---|
  | School | Class → Section | Nursery, LKG, UKG, Class 1–10 | which classes it runs |
  | Intermediate | Year → Group → Stream → Section | Junior → Senior, Long Term; MPC, BiPC, CEC, HEC; "Regular (IPE)" in every group | which groups; its own streams (IIT, JEE Mains, NEET, NEET Long Term…) |
  | Degree, Engineering | Course → Specialization → Year → Section | 1st Year … Nth Year | courses with their own years (B.Com), or courses with specializations (B.Tech › CSE), each with its number of years |

  Level names can be renamed; their number is fixed by the type.
- **Sections** belong to a **branch** and sit under a class of the level just above them, e.g. KPHB: *Junior → MPC → JEE Mains → JEE-A*. Students are placed in sections. Everything above sections belongs to the whole organization, so a Director can filter "Junior › MPC › JEE Mains" across all branches.
- **Groups at each branch** (Intermediate, ADR-0032): the organization switches groups on; each branch ticks which of them it runs (e.g. NAD: MPC + BiPC, Madhurawada: MPC only). Its sections can only go under those. New branches and newly switched-on groups start ticked everywhere.
- **Courses without specializations** (Degree / Engineering, ADR-0033): B.Com gets its years directly; a hidden "whole course" level keeps the four levels and is never shown ("B.Com › 1st Year › A"). Courses and specializations can be renamed, given more or fewer years (only empty years go), and deleted while nothing has sections.
- **Long Term** (Intermediate) is for students who already finished Intermediate (e.g. NEET repeaters): one year, long-term streams only, no promotion.
- **Progression:** each year-level class has a **next** class, e.g. Class 9 → Class 10, Junior → Senior, 1st Year → 2nd Year. Empty means students **complete** after that year (Class 10, Senior, Long Term, the final year). Promotion (Students module) follows it.
- **Subjects:** the organization's list. A subject is attached to a class at **any level**, and the classes below **inherit** it: Mathematics on "MPC" means Mathematics in every MPC section of every branch.
- **Calendar:** weekly off days for the organization (e.g. Sunday), and holidays (one day or a range) for every branch or one branch. Attendance uses it for working days.

## Endpoints (`/api/v1`)

| Method | Path | Permission | Where it's checked |
|---|---|---|---|
| GET | `/academic-years` | `academic.year.view` | anyone who has it somewhere |
| POST / PATCH | `/academic-years`, `/academic-years/:id` | `academic.year.create` / `update` | whole organization; dates never overlap |
| POST | `/academic-years/:id/activate` | `academic.year.update` | whole organization; closes the previous current year |
| DELETE | `/academic-years/:id` | `academic.year.delete` | whole organization; planned years without students only |
| GET | `/academic-structure` | `academic.structure.view` | `{ type, levels, yearLevel, sectionLevel, classes (above sections), builtIn }` |
| PUT | `/academic-structure/level-names` | `academic.structure.update` | whole organization; `{ names }` (same number) |
| PUT | `/academic-structure/school-classes` | `academic.structure.update` | School; `{ codes: ["C8","C9",...] }`, each class's next = the next ticked one |
| PUT | `/academic-structure/groups` | `academic.structure.update` | Intermediate; `{ codes: ["MPC","BIPC"] }` |
| POST | `/academic-structure/streams` | `academic.structure.create` | Intermediate; `{ groupCode, name, code, longTerm? }` |
| PATCH / DELETE | `/academic-structure/streams/:group/:code` | `academic.structure.update` / `delete` | Intermediate; rename everywhere / delete without sections |
| POST | `/academic-structure/courses` | `academic.structure.create` | Degree, Engineering; `{ name, code, years? }` (years = no specializations) |
| POST | `/academic-structure/courses/:id/specializations` | `academic.structure.create` | `{ name, code, years }`: also creates 1st Year … Nth Year with their next |
| PATCH / DELETE | `/academic-structure/programmes/:id` | `academic.structure.update` / `delete` | a course or specialization: `{ name?, code?, years? }`; delete while nothing has sections |
| PATCH | `/classes/:id` | `academic.structure.update` | its place (organization, or the section's branch); `{ name, code, sortOrder, isActive, nextClassId }` |
| DELETE | `/classes/:id` | `academic.structure.delete` | its place; not built-in, nothing under it, no student ever placed there |
| GET | `/branches/:id/sections` | `academic.structure.view` | the branch; each section with its `path` |
| PUT | `/branches/:id/groups` | `academic.structure.update` | the branch; Intermediate; `{ codes }`, out of the organization's groups; not while sections are under a removed one |
| POST | `/branches/:id/sections` | `academic.structure.create` | the branch; `{ parentId, name, code }` |
| GET / POST / PATCH / DELETE | `/subjects`, `/subjects/:id` | `academic.subject.*` | whole organization; delete only when no class uses it |
| GET / PUT | `/classes/:id/subjects` | `academic.structure.view` / `update` | `{ own, inherited, available, path }` / `{ subjectIds }` |
| GET | `/calendar?from=&to=` | `academic.calendar.view` | weekly off days and the holidays you may see |
| PUT | `/calendar/weekly-off` | `academic.calendar.update` | whole organization; `{ days: [0..6] }`, 0 = Sunday |
| POST / DELETE | `/holidays`, `/holidays/:id` | `academic.calendar.create` / `delete` | whole organization, or the branch for a branch holiday |

## Rules (tested in `test/academic.e2e-spec.ts`)

1. Nothing works unless the organization has the Academic module.
2. **The structure follows the type:**
   - structure routes for another type are refused
   - built-in classes keep their code and are switched off rather than deleted
   - a class with classes or students under it can't be deleted
3. **Above sections is the organization's:** changing it needs the permission for the whole organization.
4. **Sections are the branch's,** and (Intermediate) only under a group the branch runs: a Branch admin builds their own branch's sections. A section sits under a class of the level just above it, and section codes are unique per parent per branch.
5. **Same code, same place:** use the same section code next year (e.g. "A" under Junior and under Senior), and promotion finds the matching section by itself.
6. Academic years never overlap; at most one is current; a closed year can't change.
7. Another organization sees none of it.
8. Every change goes to the audit log, with the branch for branch-level changes.

## Screens (web app → Academic)

- **Academic years**
- **Structure:**
  - the builder for the organization's type (school classes / groups and streams / **courses and specializations as a table**, with Add, Edit and Delete)
  - Intermediate: **Groups at each branch** (branches × groups)
  - "After each year" (progression)
  - level names
  - the whole tree, with subject links
- **Sections:** choose a branch, see and add its sections
- **Subjects**
- **Calendar**

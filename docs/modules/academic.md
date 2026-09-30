# Module: academic (academic years, class structure, batches)

| | |
|---|---|
| Status | **Built (part 1):** academic years, class levels, classes, batches. **Later:** subjects, holidays |
| Code | `src/modules/academic/` |
| Tables | `academic_years`, `class_levels`, `classes`, `batches` |
| Decisions | ADR-0019 (and ADR-0018 for places) |
| Switched on by | the super admin, per organization (module key `academic`) |

## In plain words

- **Academic years:** each institution's years, e.g. "2026-27" from 1 June 2026 to 31 March 2027. One is **active** (the current one).
- **Class levels:** how an institution divides its classes, top to bottom. Every institution names its own:

  | Institution | Levels |
  |---|---|
  | Junior college (default) | Year → Group → Section |
  | Degree college (default) | Year → Course → Section |
  | Engineering college (default) | Year → Branch → Section |
  | School (default) | Class → Section |
  | A coaching-style institution | Type → Group → Stream → Section |

- **Classes:** each campus builds a tree that follows the levels, e.g. *1st year → MPC → Section A*. The last level ("section") is where students will be placed.
- **Batches:** students who joined together and move on together, e.g. "2026-28 batch", with a **stage** in the institution's own words (Junior, Senior, Long term, Passed out…).

## Endpoints (`/api/v1`)

| Method | Path | Permission | Where it's checked |
|---|---|---|---|
| GET | `/academic-years?institutionId=` | `academic.year.view` | lists years of institutions you work in |
| POST | `/academic-years` | `academic.year.create` | the institution |
| PATCH | `/academic-years/:id` | `academic.year.update` | the institution |
| POST | `/academic-years/:id/activate` | `academic.year.update` | the institution; closes the previous active year |
| DELETE | `/academic-years/:id` | `academic.year.delete` | the institution; planned years only |
| GET | `/institutions/:id/class-levels` | `academic.structure.view` | anyone working in the institution |
| PUT | `/institutions/:id/class-levels` | `academic.structure.update` | the institution; `{ names: [...] }` top to bottom |
| GET | `/campuses/:id/classes` | `academic.structure.view` | the campus; returns `{ campus, levels, classes }` |
| POST | `/campuses/:id/classes` | `academic.structure.create` | the campus; `{ parentId?, name, code }` |
| PATCH | `/classes/:id` | `academic.structure.update` | the campus |
| DELETE | `/classes/:id` | `academic.structure.delete` | the campus; only without classes under it |
| GET | `/batches?institutionId=` | `academic.batch.view` | anyone working in the institution |
| POST / PATCH / DELETE | `/batches`, `/batches/:id` | `academic.batch.create` / `update` / `delete` | the institution |

## Rules (tested in `test/academic.e2e-spec.ts`)

1. Nothing works unless the organization has the Academic module.
2. Levels: 1 to 6; rename any time; add or remove only while the institution has no classes.
3. A class is one level below its parent, on the same campus; nothing below the last level; codes unique among siblings.
4. Academic years of one institution never overlap; at most one is active; a closed year can't change; only planned years can be deleted.
5. A Campus admin builds classes only on their campus and sees (not changes) their institution's years, levels and batches. A Principal manages all of their institution.
6. Another organization sees none of it.
7. Every change goes to the audit log with its institution / campus.

## Screens (web app → Academic)

Academic years · Classes (pick a campus, see and grow the tree; "Edit levels") · Batches.

## Later

Subjects per class, holidays and working days, batch sections if needed, copying a campus's structure to another campus, promotion of batches (with the Students module).

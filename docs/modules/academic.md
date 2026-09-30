# Module: academic

> **Status: design, not built yet.** Written before the backend was simplified; the purpose, data and rules still apply, the technical details (schemas, paths, `.manage` permissions, events) will follow today's conventions when it is built. See [README.md](README.md#reading-the-design-documents).

| | |
|---|---|
| Schema | `academic` |
| Phase | 3 |
| Depends on | platform |
| Code | `services/academic/` |

## Purpose

The academic structure of each institution, built from a template: which years, groups and sections exist on each campus, in which academic year, with which subjects, and which days are working days (doc 3 §3.3).

## Responsibilities

- Structure templates and their levels (platform-provided).
- Structure nodes: a tree per campus, e.g. 1st year → MPC → Section A.
- Academic years and which nodes run in each year.
- Subjects and the node ↔ subject mapping.
- Holidays and the working-day calendar.

Not this module: which students are in a section (`students`), attendance rules (`attendance`), timetables (v2).

## Manifest

- Variants (structure templates): `junior_college_v1` (v1); `degree_v1`, `engineering_v1`, `school_v1` (planned, v3).
- Settings (institution level): `section.defaultCapacity` (default 60), `weeklyOff` (default `["sunday"]`).

## Permissions

| Permission | Allows |
|---|---|
| `academic.structure.view` | See the structure tree, years, subjects, holidays |
| `academic.structure.manage` | Create, edit and deactivate nodes |
| `academic.year.manage` | Create, activate and close academic years; set year offerings |
| `academic.subject.manage` | Create and edit subjects and their mapping to nodes |
| `academic.calendar.manage` | Manage holidays |

## Data model

### Platform-level (seeded by migrations)

```
academic.structure_templates
  key             text pk               'junior_college_v1'
  name            text not null
  institution_type text not null
  status          text check (available | planned)
  promotion_rule  jsonb not null        how nodes map to the next year

academic.structure_levels
  template_key    text references academic.structure_templates
  key             text                  'year' | 'group' | 'section'
  name            text not null
  position        smallint not null     unique (template_key, position)
  is_enrolment_level boolean not null
  primary key (template_key, key)
```

Seed for `junior_college_v1`: `year` (1) → `group` (2) → `section` (3, enrolment level). Promotion rule: 1st year → 2nd year, same group code, same section code by default, re-assignable in the preview.

### Tenant-owned

```
academic.academic_years                                                                      [std]
  id, tenant_id
  institution_id  uuid not null
  code            text not null         '2026-27'; unique (tenant_id, institution_id, code)
  starts_on       date not null
  ends_on         date not null         check (starts_on < ends_on)
  status          text check (planned | active | closed)
  unique (tenant_id, institution_id) where status = 'active'
  exclude using gist (tenant_id with =, institution_id with =,
                      daterange(starts_on, ends_on, '[]') with &&)

academic.structure_nodes                                                                     [std][sd]
  id, tenant_id
  institution_id  uuid not null
  campus_id       uuid not null
  parent_id       uuid                  fk (tenant_id, parent_id) → structure_nodes; null for roots
  template_key    text not null
  level_key       text not null         fk (template_key, level_key) → structure_levels
  code            text not null         'MPC', 'A'
  name            text not null
  sort_order      integer not null default 0
  ancestor_ids    uuid[] not null       root → parent; GIN index
  depth           smallint not null
  capacity        integer               enrolment-level nodes only
  is_active       boolean not null default true
  unique nulls not distinct (tenant_id, campus_id, parent_id, code) where deleted_at is null

academic.node_year_offerings
  tenant_id, node_id, academic_year_id
  capacity        integer               overrides the node's capacity for that year
  is_active       boolean not null default true
  primary key (tenant_id, node_id, academic_year_id)

academic.subjects                                                                            [std][sd]
  id, tenant_id, institution_id
  code            text not null         unique (tenant_id, institution_id, code) where deleted_at is null
  name            text not null
  short_name      text
  kind            text check (theory | practical | language | elective | other)
  is_active       boolean not null default true

academic.node_subjects
  tenant_id, node_id, subject_id, academic_year_id
  is_optional     boolean not null default false
  primary key (tenant_id, node_id, subject_id, academic_year_id)

academic.holidays                                                                            [std][sd]
  id, tenant_id, institution_id
  campus_id       uuid                  null = whole institution
  on_date         date not null
  name            text not null
  kind            text check (holiday | exam_day | event | working_day)   'working_day' overrides a weekly off
  unique nulls not distinct (tenant_id, institution_id, campus_id, on_date) where deleted_at is null
```

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/academic/structure-templates` | `academic.template.list` | `academic.structure.view` | Templates and levels |
| GET | `/academic/structure-nodes` | `academic.node.list` | `academic.structure.view` | Tree for `?campusId&academicYearId&includeInactive` |
| POST | `/academic/structure-nodes` | `academic.node.create` | `academic.structure.manage` | Create one node |
| POST | `/academic/structure-nodes/generate` | `academic.node.generate` | `academic.structure.manage` | Create a grid in one call, e.g. years [1,2] × groups [MPC, BiPC, CEC] × sections [A, B]; preview with `?dryRun=true` |
| GET | `/academic/structure-nodes/{nodeId}` | `academic.node.get` | `academic.structure.view` | One node with its path |
| PATCH | `/academic/structure-nodes/{nodeId}` | `academic.node.update` | `academic.structure.manage` | Rename, reorder, capacity, activate or deactivate |
| DELETE | `/academic/structure-nodes/{nodeId}` | `academic.node.delete` | `academic.structure.manage` | Soft delete; blocked if it or a descendant has enrolments |
| GET | `/academic/academic-years` | `academic.year.list` | `academic.structure.view` | Years of `?institutionId` |
| POST | `/academic/academic-years` | `academic.year.create` | `academic.year.manage` | Create a planned year |
| PATCH | `/academic/academic-years/{yearId}` | `academic.year.update` | `academic.year.manage` | Edit dates while planned |
| POST | `/academic/academic-years/{yearId}/activate` | `academic.year.activate` | `academic.year.manage` | Make it the active year (the previous one must be closed or closes now) |
| POST | `/academic/academic-years/{yearId}/close` | `academic.year.close` | `academic.year.manage` | Close |
| PUT | `/academic/academic-years/{yearId}/offerings` | `academic.offering.put` | `academic.year.manage` | Which nodes run in the year |
| GET | `/academic/subjects` | `academic.subject.list` | `academic.structure.view` | `?institutionId&q` |
| POST | `/academic/subjects` | `academic.subject.create` | `academic.subject.manage` | Create |
| PATCH | `/academic/subjects/{subjectId}` | `academic.subject.update` | `academic.subject.manage` | Edit |
| DELETE | `/academic/subjects/{subjectId}` | `academic.subject.delete` | `academic.subject.manage` | Soft delete |
| PUT | `/academic/structure-nodes/{nodeId}/subjects` | `academic.node_subject.put` | `academic.subject.manage` | Subjects of a node in `?academicYearId` |
| GET | `/academic/holidays` | `academic.holiday.list` | `academic.structure.view` | `?institutionId&campusId&from&to` |
| POST | `/academic/holidays` | `academic.holiday.create` | `academic.calendar.manage` | Add one or many dates |
| PATCH | `/academic/holidays/{holidayId}` | `academic.holiday.update` | `academic.calendar.manage` | Edit |
| DELETE | `/academic/holidays/{holidayId}` | `academic.holiday.delete` | `academic.calendar.manage` | Soft delete |

## Events

Published:

| Type | When | Data |
|---|---|---|
| `academic.node.created` | Node created | `nodeId, parentId, levelKey, code, name, ancestorIds, campusId, institutionId` |
| `academic.node.updated` | Renamed, moved, capacity or active flag changed | `nodeId, fields, ancestorIds` |
| `academic.node.deleted` | Soft deleted | `nodeId` |
| `academic.year.activated` | Year activated | `academicYearId, institutionId, code` |
| `academic.year.closed` | Year closed | `academicYearId, institutionId` |
| `academic.calendar.changed` | Holidays added, edited or removed | `institutionId, campusId, dates` |

Consumed: `platform.institution.changed` (a new institution gets its template recorded).

## Public facade

```ts
interface AcademicFacade {
  getNode(nodeId): Promise<Node | null>;
  getNodePath(nodeId): Promise<Node[]>;                        // root → node, for labels like "1st Year / MPC / A"
  isEnrolmentNode(nodeId, academicYearId): Promise<boolean>;   // enrolment level, active, offered that year
  getActiveYear(institutionId): Promise<AcademicYear | null>;
  getYear(academicYearId): Promise<AcademicYear | null>;
  nextYearNode(nodeId, toAcademicYearId): Promise<string | null>;   // promotion rule
  isWorkingDay(institutionId, campusId, date): Promise<boolean>;
}
```

## Business rules

1. A node's level must be the next level after its parent's level in the same template; roots use the first level.
2. Students can enrol only in enrolment-level nodes that are active and offered in that academic year.
3. One active academic year per institution; years never overlap.
4. Deactivating a node keeps its history; it just can't take new enrolments.
5. A closed year is read-only for structure changes.

## Tests

- Generating 2 years × 3 groups × 2 sections on 2 campuses creates 2 × (2 + 6 + 12) = 40 nodes, and a second run creates none (idempotent by code).
- Creating a section directly under a year (skipping the group level) fails.
- Two active years for one institution is rejected by the database.

## Open questions

- None.

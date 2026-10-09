# 2. Domain map

> **Note (2026-10-09):** since [ADR-0030](adr/0030-organization-branches-and-academic-engine.md) an organization has ONE type (School, Intermediate, Degree, Engineering) and several **branches**; there are no institutions or campuses any more. Where this document says *institution* or *campus*, read *organization* or *branch*. The rest is the original design.

The API is a **modular monolith** ([ADR-0001](adr/0001-modular-monolith.md)). Each box below is a module: its own folder, its own Postgres schema, its own public interface and events. Any module can later be extracted into a separate service because none of them share tables.

## 2.1 Modules

```
                       ┌──────────────────────── PLATFORM ────────────────────────┐
                       │  platform        identity        access        audit     │
                       │  (tenants,       (users,         (roles,       (audit    │
                       │   plans,          Keycloak        permissions,  log)     │
                       │   entitlements,   link,           scopes)                │
                       │   settings)       guardians)                             │
                       └───────────────────────────┬──────────────────────────────┘
                                                   │ used by every module
   ┌────────────────────────────────── EDUCATION DOMAIN ─────────────────────────────────┐
   │  academic ◄──── students ◄──── attendance        exams (v2)      fees (v2)         │
   │  (structure,    (admissions,   (records,          staff (v2)      timetable (v2)    │
   │   years,         profiles,      sources,          transport (v3)  library (v3) ...  │
   │   subjects)      enrolments)    devices)                                           │
   └─────────────────────────────────────────────────────────────────────────────────────┘
   ┌────────────────────────────────── SUPPORTING ───────────────────────────────────────┐
   │  files (documents/photos, S3)   imports (onboarding ETL)   notifications (v2)       │
   │  reporting (read models built from events)                                         │
   └─────────────────────────────────────────────────────────────────────────────────────┘
```

## 2.2 Ownership

| Module | Schema | Owns (source of truth) | Key events it publishes |
|---|---|---|---|
| **platform** | `platform` | organizations (tenants), institutions, campuses, plans, module catalog, entitlements, module settings, feature flags, limits | `platform.tenant.created`, `platform.module.enabled`, `platform.module.disabled`, `platform.settings.changed` |
| **identity** | `identity` | user accounts (login accounts linked to their Keycloak subject) for staff, parents and students; user ↔ institution memberships. Student and guardian *profiles* belong to `students` ([doc 7](07-database-design.md) decision 1). | `identity.user.created`, `identity.user.deactivated` |
| **access** | `access` | permission catalog (synced from module manifests), roles, role permissions, role assignments with scope | `access.role.changed`, `access.assignment.changed` |
| **audit** | `audit` | append-only audit log | — |
| **academic** | `academic` | structure templates, structure nodes (year / group / section …), academic years, subjects, section ↔ subject mapping | `academic.node.created`, `academic.year.activated` |
| **students** | `students` | students, guardians and guardian links, consents, enrolments (student ↔ section ↔ academic year), categories, status history, documents metadata | `students.student.admitted`, `students.enrolment.changed`, `students.student.status_changed` |
| **attendance** | `attendance` | attendance policies, raw events (punches), attendance records, devices, device ↔ person mapping, corrections | `attendance.record.marked`, `attendance.record.corrected` |
| **files** | `files` | file metadata; binaries in object storage | `files.file.uploaded` |
| **imports** | `imports` | import jobs, row-level results and errors | `imports.job.completed` |
| **reporting** | `reporting` | read-only projections built from events | — |

## 2.3 Dependencies

```
platform, identity, access, audit, files  ← no domain dependencies (foundation)
academic      → platform
students      → academic, identity, files
attendance    → students, academic, identity
imports       → students, academic, identity (calls their public interfaces)
exams (v2)    → students, academic
fees (v2)     → students, academic
reporting     → events from all modules
```

The platform enforces this graph: a module can't be enabled for a tenant unless its dependencies are enabled.

## 2.4 Communication rules

| Need | Mechanism |
|---|---|
| Module A needs data from module B **right now** (for example, attendance validates that a student exists) | Call B's **public service interface** (in-process today, HTTP when B is extracted) |
| Module A must **react** to something in B (for example, attendance creates a roster when a student is enrolled) | B publishes an **event through its outbox**; A subscribes via the worker |
| Reports across modules | The **reporting** module builds read models from events. It never queries other schemas. |
| A module keeps a local copy of another's data (for example, a student's name for attendance reports) | Allowed as a **projection** updated from events, and clearly marked as not the source of truth |

## 2.5 Service folder layout

Each module is a service package ([ADR-0011](adr/0011-microservice-ready-services.md)):

```
services/students/            package @eduplatform/students-service
  README.md                   what the service does; links to docs/modules/students.md
  migrations/                 0001_*.sql …: tables in schema "students"
  src/
    index.ts                  ServiceDefinition: imported only by host apps
    manifest.ts               module manifest (see doc 5)
    students.module.ts        NestJS wiring
    public/                   the ONLY things other services may import
      students.facade.ts        ('@eduplatform/students-service/public')
      dto/
    http/                     controllers (guards + validation)
    application/              use cases
    domain/                   entities, rules
    infrastructure/           repositories, SQL
    events/                   published + consumed event handlers
  test/                       unit, integration, tenant-isolation
```

A lint rule and an architecture test block imports of another service's non-`public/` code. The host app `apps/api` runs every service listed in its `src/services.ts`.

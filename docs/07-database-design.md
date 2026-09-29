# 7. Database design (v1)

Status: **Draft for review.** This document turns docs 2–5 and ADR-0002 / 0005 / 0006 into concrete tables. Per-module detail (every column, index and policy) lives in each module's document under [`modules/`](modules/). Migrations are written from these documents phase by phase; when a migration and a document disagree, fix one of them in the same change.

## 7.1 Scope

| Schema | Phase | Module document |
|---|---|---|
| `app` (shared functions only, no tables) | 1 | this document, §7.4 |
| `platform` | 2 | [modules/platform.md](modules/platform.md) |
| `identity` | 2 | [modules/identity.md](modules/identity.md) |
| `access` | 2 | [modules/access.md](modules/access.md) |
| `audit` | 1–2 | [modules/audit.md](modules/audit.md) |
| `files` | 2 | [modules/files.md](modules/files.md) |
| `academic` | 3 | [modules/academic.md](modules/academic.md) |
| `students` | 4 | [modules/students.md](modules/students.md) |
| `attendance` | 5 | [modules/attendance.md](modules/attendance.md) |
| `imports` | 7 | [modules/imports.md](modules/imports.md) |
| `reporting` | 5–6 | Projections are designed with the report that needs them |
| v2 modules (exams, fees, staff, notifications, timetable) | 8 | Not yet |

## 7.2 Conventions

These apply to every table unless the module document says otherwise.

| Topic | Rule |
|---|---|
| Primary key | `id uuid primary key`, a UUIDv7 generated **in the application**, so the id is known before the insert (for audit entries and events in the same transaction) and works on any Postgres version. No database defaults for ids. |
| Tenant key | `tenant_id uuid not null` on every tenant-owned table. Each such table also has `unique (tenant_id, id)`, so that foreign keys **inside a module** are composite: `(tenant_id, x_id) references t (tenant_id, id)`. A row can then never point at another tenant's row, even by a bug. |
| Cross-module references | Plain `uuid` columns **without** foreign keys (for example `students.enrolments.node_id` → `academic.structure_nodes`). The owning module validates them through the other module's facade. Listed in §7.7. |
| Standard columns `[std]` | `created_at timestamptz not null default now()`, `created_by uuid`, `updated_at timestamptz not null default now()`, `updated_by uuid`, `version integer not null default 1`. `created_by` / `updated_by` hold `identity.users.id` (null for system actions). Updates use `where version = $expected` for optimistic locking. |
| Soft delete `[sd]` | `deleted_at timestamptz`, `deleted_by uuid`. Unique constraints on soft-deleted tables are partial indexes `where deleted_at is null`. |
| Enumerations | `text` with a `check (... in (...))` constraint, not Postgres `enum` types (adding a value to a check is a simple migration; enums are awkward to change). |
| Time | `timestamptz` in UTC for instants; `date` for calendar days; `time` for wall-clock times in an institution's time zone (e.g. "late after 09:15"). |
| Flexible data | `jsonb`, always validated by a zod schema in the application. Never used for data that other modules filter on. |
| Nullable uniqueness | `unique nulls not distinct (...)` (Postgres 15+) where a null means "not scoped", e.g. organization-level settings. |
| Indexes | Every index on a tenant table starts with `tenant_id`. Foreign-key columns are indexed. |
| Personal data | Columns are tagged in migrations with `comment on column ... is '@pii'` or `'@pii @sensitive'`. Export / erasure tooling and a test read these tags (DPDP Act). Tagged in module documents as **[P]** and **[S]**. |
| Extensions | Installed into schema `extensions` by the migration owner: `btree_gist` (exclusion constraints), `pg_trgm` (name search). |

## 7.3 Database roles

Each process connects with the least-privileged role that can do its job. No runtime role has `BYPASSRLS`. Recorded in [ADR-0009](adr/0009-database-roles.md).

| Role | Used by | BYPASSRLS | Rights |
|---|---|:-:|---|
| `edu_owner` | Migration runner only (CI / deploy), never at runtime | yes | Owns every schema and table |
| `edu_app` | `api` tenant endpoints, `worker` jobs | **no** | `select/insert/update/delete` on tenant tables of all modules, **except** `audit` (insert + select only); `select` on platform catalog tables |
| `edu_platform` | `api` super admin endpoints (`/api/v1/admin/...`) | **no** | Full access to schema `platform`; an extra policy `to edu_platform using (true)` on tenant tables **of schema `platform` only**; `insert/select` on `audit.platform_entries`. To act *inside* a tenant it uses `edu_app` with that tenant's context. |
| `edu_relay` | Outbox relay loop in `worker` | **no** | `select` and `update (published_at, attempts, last_error)` on every `<schema>.outbox` through a policy `to edu_relay using (true)`. Nothing else. |
| `edu_gateway` | `device-gateway` | **no** | `execute` on `attendance.resolve_device(serial)` (security definer) and `insert` on `attendance.raw_events` under the device's tenant context |
| `keycloak` | Keycloak | — | Owns the separate database `keycloak` on the same server; no access to ours |

All modules share `edu_app` inside the monolith; boundaries are enforced by code (lint rule, facade-only imports) and by the tests in §7.8. An extracted module gets its own role that reaches only its schema.

## 7.4 Row-Level Security template

Created once in Phase 1 by `edu_owner`:

```sql
create schema app;

-- Fails loudly when the tenant context is missing, instead of silently matching nothing.
-- With set_config(..., true) the setting reverts to '' after each transaction, so a pooled
-- connection that forgot to set it gets this error too.
create function app.current_tenant_id() returns uuid
language plpgsql stable as $$
declare v text := current_setting('app.tenant_id', true);
begin
  if v is null or v = '' then
    raise exception 'app.tenant_id is not set' using errcode = '42501';
  end if;
  return v::uuid;
end $$;
```

Added by every migration that creates a tenant table:

```sql
alter table students.students enable row level security;
alter table students.students force row level security;

create policy tenant_isolation on students.students
  for all to edu_app
  using      (tenant_id = (select app.current_tenant_id()))
  with check (tenant_id = (select app.current_tenant_id()));
```

The `(select ...)` wrapper makes Postgres evaluate the function once per statement instead of once per row.

Each request and each background job runs in a transaction that starts with:

```sql
select set_config('app.tenant_id', $1, true);   -- true = local to this transaction
```

## 7.5 Outbox and inbox (every module)

Same shape in each schema (ADR-0006).

```
<schema>.outbox                                        tenant · RLS (edu_app) + relay policy (edu_relay)
  id             uuid         pk; also the CloudEvents id
  tenant_id      uuid         not null
  type           text         not null   e.g. 'students.student.admitted'
  subject        text         not null   id of the entity the event is about; ordering key
  data_schema    text         not null   e.g. 'students.student.admitted/1'
  data           jsonb        not null
  occurred_at    timestamptz  not null default now()
  published_at   timestamptz             null until relayed
  attempts       integer      not null default 0
  last_error     text
  index (tenant_id, id)
  index (id) where published_at is null          -- relay scan, UUIDv7 = time order

<schema>.inbox                                         tenant · RLS
  event_id       uuid         not null
  consumer       text         not null   handler name, e.g. 'attendance.on_enrolment_changed'
  tenant_id      uuid         not null
  processed_at   timestamptz  not null default now()
  primary key (event_id, consumer)
  index (tenant_id, processed_at)
```

All v1 events are about a tenant, so `outbox.tenant_id` is never null, including in `platform`.

The relay gets two policies (Postgres policies cover one command each): `for select to edu_relay using (true)` and `for update to edu_relay using (true) with check (true)`, plus `update` rights on `published_at, attempts, last_error` only. `edu_app` gets `insert` only on the outbox. The reference migration is `apps/api/test/fixtures/sample/migrations/0001_notes.sql`.

Migrations are tracked per schema in `<schema>.schema_migrations (version text pk, applied_at timestamptz, checksum text)`, so each module's migrations can move with it if it is extracted.

## 7.6 Growth and partitioning

`audit.entries`, `attendance.raw_events` and `attendance.records` are partitioned by month from day one. A 5,000-student college marking 6 periods a day writes about 7.5 million attendance records a year; converting a large table to partitions later is a risky migration. The worker creates partitions three months ahead. Partitioned tables include the partition column in their primary key and unique constraints.

## 7.7 Cross-module references (no foreign keys)

| Column | Points to | Kept correct by |
|---|---|---|
| `*.created_by`, `*.updated_by`, `access.role_assignments.user_id`, `students.*.user_id` | `identity.users` | Facade check on write |
| `*.institution_id`, `*.campus_id` | `platform.institutions`, `platform.campuses` | Facade check on write |
| `access.role_assignments.scope_id` | platform institution / campus, or academic node | Facade check on write |
| `students.enrolments.node_id`, `academic_year_id` | `academic` | Facade check; `node_ancestor_ids` kept current from `academic.node.*` events |
| `attendance.*.person_id` | `students.students` | Facade check; `person_directory` kept current from `students.*` events |
| `*.file_id`, `*_file_id` | `files.files` | Facade check on write |
| `platform.institutions.structure_template_key` | `academic.structure_templates` | Facade check on write |

## 7.8 Tests that enforce this design

Run against real PostgreSQL 18 with all migrations applied: locally on your own server, in CI on a Postgres service container (ADR-0012). Code: `apps/api/test/integration/database.int.test.ts`.

1. Every table with a `tenant_id` column has RLS **enabled and forced** and a `tenant_isolation` policy.
2. No foreign key crosses schemas.
3. Every table with `tenant_id` has an index (or primary key) whose first column is `tenant_id`.
4. `edu_app` has no `update` or `delete` right on any `audit` table.
5. No runtime role has `BYPASSRLS` or owns a table.
6. With `app.tenant_id` unset, and with it set to `''`, a select on a tenant table raises an error.
7. Rows created in tenant A are invisible, un-updatable and un-deletable from tenant B; inserting a row with tenant A's id while in tenant B's context fails.
8. Every column marked [P] in a module document carries its `@pii` comment.

## 7.9 Decisions this design makes (need owner review)

| # | Decision | Alternative | Why this one |
|---|---|---|---|
| 1 | **Guardian profiles belong to `students`**; `identity` holds only login accounts. | Guardians in `identity` (doc 2's wording) | Guardians are captured at admission whether or not a portal login ever exists. |
| 2 | **Aadhaar: last 4 digits only.** | Full number in an encrypted vault | Legal limits on storing full Aadhaar numbers; data minimization. |
| 3 | **Attendance rules live in `attendance.policies`** (date-effective). `platform.module_settings` keeps only variant switches and simple toggles. | All attendance settings in `module_settings` | Rules change mid-year; old records must stay explainable. |
| 4 | **Partition the three fastest-growing tables from day one** (§7.6). | Partition later | Converting later is risky. |
| 5 | **Audit vs. erasure:** audit is append-only; a maintenance function run by `edu_owner` redacts personal fields for DPDP erasure and records that it did. | No personal data in audit diffs | Diffs are only useful if they show what changed. |
| 6 | **No staff profile tables in v1**; the v2 `staff` module adds them. | A small staff profile now | Avoids moving data between modules later. |
| 7 | **Device serial numbers are unique across all tenants.** | Unique per tenant | The gateway identifies the tenant by serial. |
| 8 | **Database roles as in §7.3** (ADR-0009). | One app role | Least privilege. |

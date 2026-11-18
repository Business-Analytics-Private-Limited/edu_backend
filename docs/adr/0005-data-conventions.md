# ADR-0005: IDs, time, money, soft delete and audit conventions

Status: Accepted
Date: 2026-09-28

## Decision

| Topic | Convention |
|---|---|
| Primary keys | `uuid`, generated as **UUIDv7** (time-ordered, globally unique, safe to move between databases) |
| Human-readable codes | Separate columns (`admission_no`, `code`), unique per tenant or institution, never used as foreign keys |
| Tenant key | `tenant_id uuid not null` on every tenant-owned table, first column of tenant-scoped indexes |
| Time | `timestamptz`, stored in UTC; displayed in the institution's time zone |
| Calendar dates | `date` for things that are dates (date of birth, attendance day), never timestamps |
| Money (v2) | `numeric(14,2)` plus a `currency` column; never floating point |
| Standard columns | `created_at`, `created_by`, `updated_at`, `updated_by`, `version` (optimistic locking) |
| Deletion | Soft delete (`deleted_at`, `deleted_by`) for business records; hard delete only through data-erasure requests |
| Status history | Important status changes (student status, enrolment) are stored as history rows, not just overwritten |
| Flexible fields | Tenant custom fields in a `custom_fields jsonb` column validated against the tenant's field definitions |
| Personal data | Columns that hold personal data are tagged in the schema docs to support export and erasure (DPDP Act) |
| Audit | Every create, update and delete writes `audit.entries` (who, when, tenant, entity, before/after diff, request id) |
| Naming | snake_case, plural table names, schema = module key |

## Consequences

IDs never collide when merging or moving tenants. Time-zone bugs are prevented by design. History and auditability are built in rather than added later.

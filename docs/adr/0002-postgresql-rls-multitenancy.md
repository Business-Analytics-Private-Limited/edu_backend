# ADR-0002: PostgreSQL, schema per module, Row-Level Security for tenants

Status: Accepted
Date: 2026-09-28

## Context

Many organizations share one deployment. A leak of student data between tenants would be the worst possible failure. Most tenants are small to medium, and a few large groups may need dedicated capacity or contractual isolation.

## Decision

- **PostgreSQL 16+** is the only operational database.
- **One schema per module** (`platform`, `identity`, `access`, `academic`, `students`, `attendance`, …).
- **Pooled tenancy by default:** tenant-owned tables carry `tenant_id` and have Row-Level Security enabled and forced. The application database role has no `BYPASSRLS`. Each request transaction sets `app.tenant_id`. A missing setting causes an error instead of returning all rows.
- **Silo when needed:** `platform.tenant_placements` maps each tenant to a database cluster. The connection resolver uses it, so a tenant can move to a dedicated cluster without code changes.
- Institution, campus and node scoping inside a tenant is enforced by the application (access module). RLS guards only the tenant boundary.
- The ORM/query layer is **Drizzle ORM**, with versioned SQL migrations per module. It keeps SQL visible, supports Postgres features (RLS, JSONB, `set_config`) directly and has no heavy runtime.

## Consequences

- Two independent layers (application filters and database policy) must both fail before data leaks.
- Every migration that adds a tenant table must add the RLS policy. A test fails if any table with `tenant_id` lacks forced RLS.
- Connection pooling must use transaction-scoped settings (`set_config(..., true)`), which is compatible with PgBouncer transaction mode.
- Background jobs must set the tenant context explicitly for each job.

## Alternatives considered

- **Database per tenant** for everyone: strongest isolation, but migrations and operations multiply with every tenant. Kept only as the silo option.
- **Schema per tenant:** migration runs grow with the tenant count, and it doesn't fit schema-per-module. Rejected.
- **Prisma:** good developer experience, but RLS / `set_config` per transaction and multi-schema ownership are harder to control. Rejected in favour of Drizzle.

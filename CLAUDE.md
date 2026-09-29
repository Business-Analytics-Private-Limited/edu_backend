# Working agreement for this repository

Read this first in every session. The design lives in `docs/`, and decisions live in `docs/adr/`.
If a change conflicts with an accepted ADR, write a new ADR that supersedes it. Don't silently diverge.

## Team

Two developers: the project owner and Claude. There is no separate reviewer, so automated tests are the safety net.

## Project context (decided with the owner, 2026-09-28)

- This is a **greenfield** build. The owner's earlier single-institute MySQL application is only a requirements reference. Don't port its code or schema (ADR-0007).
- A tenant is an **organization that can own several institutions** (organization → institution → campus).
- Institution priority: (1) junior / intermediate colleges (11th–12th, MPC/BiPC/CEC groups; the owner calls these "K12"), (2) degree and engineering colleges, (3) schools.
- Only the **platform super admin** grants modules and variants to tenants. Tenants choose among what was granted (e.g. manual vs biometric attendance).
- Parent and student logins are in v1.
- Hosting is undecided (DigitalOcean or AWS). Keep everything containerized and provider-neutral.
- The v1 / v2 / v3 scope in `docs/01-product-requirements.md` has been accepted.

## Current status

- **Phase 0 (design): documents written, waiting for the owner's review.** See `docs/06-roadmap.md`.
- Next: **Phase 1 (foundation):** monorepo, Docker Compose, CI, shared tenant / guard / outbox / audit libraries.
- Update this section at the end of every working session.


## Non-negotiable rules

1. **Every tenant-owned table has `tenant_id uuid not null`** and a PostgreSQL Row-Level Security policy. No exceptions.
2. **A module owns its schema.** Module `students` reads and writes only schema `students`. To get data from another module, call that module's public service interface or consume its events. No cross-schema joins or foreign keys.
3. **Every endpoint declares its guard:** `@RequireModule(...)` and `@RequirePermission(...)`. An endpoint without them fails the architecture test.
4. **Every feature ships with a tenant-isolation test**: data created in tenant A is invisible from tenant B.
5. **IDs are UUIDv7. Timestamps are `timestamptz` stored in UTC.** Time zone, currency and locale come from tenant or institution settings.
6. **Schema changes only through versioned migrations.** Never edit a production database by hand.
7. **Contracts first.** Add or change the OpenAPI or event schema in `packages/contracts` before implementing it.
8. **Writes that other modules care about emit an event through the outbox**, in the same transaction as the write.
9. **Every create, update and delete of business data is written to the audit log.**
10. Don't reuse the previous single-institute product's name anywhere in this repository. "EduPlatform" is a working name until the product is named.

## Naming

- Permissions: `module.resource.action`, lowercase, dot-separated (for example `attendance.record.mark`).
- Events: `module.entity.past_tense_verb` (for example `students.student.admitted`).
- Database: snake_case tables and columns, plural table names, one Postgres schema per module.
- API: `/api/v1/<module>/<resource>`, kebab-case paths, JSON bodies in camelCase.

## Stack (see ADRs)

NestJS + TypeScript (API, worker, device-gateway), PostgreSQL 18, Redis, Keycloak (OIDC), pnpm + Turborepo monorepo. Local development uses a locally installed PostgreSQL; Docker is on hold (ADR-0012).

This is the backend repository. The Next.js web and admin apps live in the separate `eduplatform-frontend` repository, which uses only the API contract from `packages/contracts` (ADR-0013). Backend services live in `services/`, one package each (ADR-0011).

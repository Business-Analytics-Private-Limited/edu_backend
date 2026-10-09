# Architecture decision records

Each file records one significant decision: the context, the decision, and its consequences. Accepted ADRs are not edited. To change a decision, write a new ADR that supersedes the old one and mark the old one `Superseded by ADR-XXXX` in this table.

**Start with [ADR-0015](0015-simplified-backend.md)**: it describes how the backend is built today. [ADR-0024](0024-microservices-and-tenant-sharding.md) (proposed) describes where it is going: microservices, with organizations spread over several databases.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith, extractable to services | Superseded by ADR-0015 |
| [0002](0002-postgresql-rls-multitenancy.md) | PostgreSQL, schema per module, Row-Level Security for tenants | Superseded by ADR-0015 (PostgreSQL and row security kept) |
| [0003](0003-identity-keycloak.md) | Keycloak for authentication; authorization in our own access module | Superseded by ADR-0015 |
| [0004](0004-monorepo-stack.md) | pnpm + Turborepo monorepo with NestJS and Next.js | Superseded by ADR-0015 (NestJS, Next.js kept) and ADR-0016 (npm) |
| [0005](0005-data-conventions.md) | IDs, time, money, soft delete and audit conventions | Accepted |
| [0006](0006-events-outbox.md) | Domain events through a transactional outbox | Superseded by ADR-0015 (deferred until needed) |
| [0007](0007-greenfield-no-legacy-schema.md) | Greenfield build; legacy data enters only through the importer | Accepted |
| [0008](0008-repository-layout.md) | Separate backend and frontend folders in one workspace; Node.js 24 | Superseded by ADR-0013 (Node.js 24 still applies) |
| [0009](0009-database-roles.md) | Database roles and cross-tenant access paths | Superseded by ADR-0015 |
| [0010](0010-api-documentation.md) | API documentation: OpenAPI, Swagger UI, generated Postman collections | Superseded by ADR-0015 (Swagger from the code) |
| [0011](0011-microservice-ready-services.md) | Microservice-ready backend: one package per service | Superseded by ADR-0015 |
| [0012](0012-local-development-without-docker.md) | Local development without Docker for now; PostgreSQL 18 | Accepted |
| [0013](0013-separate-frontend-and-backend-repositories.md) | Separate repositories for backend and frontend | Accepted |
| [0014](0014-local-keycloak-and-in-memory-cache.md) | Keycloak installed locally; in-memory cache | Superseded by ADR-0015 |
| [0015](0015-simplified-backend.md) | A simple, conventional backend | Accepted (package manager: see ADR-0016) |
| [0016](0016-npm-instead-of-pnpm.md) | npm instead of pnpm, in both repositories | Accepted |
| [0017](0017-predefined-roles-and-multiple-roles.md) | Predefined roles managed by the super admin, several roles per user | Accepted (organizations may now change predefined roles' permissions: ADR-0029) |
| [0018](0018-roles-at-places.md) | Roles apply at a place: organization, institution or campus | Superseded by ADR-0030 (organization or branch) |
| [0019](0019-academic-structure.md) | Academic structure: configurable class levels, classes per campus, batches | Superseded by ADR-0030 (levels by organization type, sections per branch, no batches) |
| [0020](0020-students.md) | Students: admission at a campus, shared guardians, one section per year | Accepted (places, placements as periods, outgoing students, import: ADR-0030) |
| [0021](0021-attendance.md) | Attendance: daily records per section, versions instead of overwrites, a correction window | Accepted |
| [0022](0022-portal.md) | Parent and student portal: logins linked to records, no roles | Accepted |
| [0023](0023-files-and-documents.md) | Files on the server's disk behind the API; student documents with types and review | Accepted |
| [0024](0024-microservices-and-tenant-sharding.md) | Move to microservices, with tenants spread over several databases | **Proposed** (when accepted, supersedes ADR-0012 and ADR-0015) |
| [0025](0025-institutions-by-super-admin-without-types.md) | Institutions are added by the super admin, and have no type | Superseded by ADR-0030 (branches; organizations have a type) |
| [0026](0026-deactivate-campuses-and-institutions.md) | Campuses and institutions are deactivated, not deleted | Accepted, now for branches (ADR-0030) |
| [0027](0027-mandatory-add-only-audit-log.md) | The audit log is mandatory and add-only, and covers logins and document access | Accepted |
| [0028](0028-login-security.md) | Login security: real visitor addresses, lockout, sessions, forced password change, two-step login | Accepted |
| [0029](0029-organizations-customize-predefined-roles.md) | Organizations may change the permissions of predefined roles | Accepted |
| [0030](0030-organization-branches-and-academic-engine.md) | Organization → Branches, and one academic engine shaped by the organization's type | Accepted |

Template for new ADRs:

```md
# ADR-XXXX: Title
Status: Proposed | Accepted | Superseded by ADR-YYYY
Date: YYYY-MM-DD

## Context
## Decision
## Consequences
## Alternatives considered
```

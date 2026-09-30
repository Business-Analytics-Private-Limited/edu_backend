# Architecture decision records

Each file records one significant decision: the context, the decision, and its consequences. Accepted ADRs are not edited. To change a decision, write a new ADR that supersedes the old one and mark the old one `Superseded by ADR-XXXX` in this table.

**Start with [ADR-0015](0015-simplified-backend.md)**: it describes how the backend is built today.

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

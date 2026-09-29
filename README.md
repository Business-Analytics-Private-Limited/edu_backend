# EduPlatform backend (working name)

A multi-tenant, role-based, module-driven management platform for educational institutions.

This is the **backend repository**: services, API, database and all design documents. The web app and super admin console live in a separate repository, **eduplatform-frontend**, which talks to this one only through the API ([ADR-0013](docs/adr/0013-separate-frontend-and-backend-repositories.md)).

- **Multi-tenant:** one deployment serves many organizations. An organization can be a group of institutions (junior college + engineering college + school).
- **Module-driven:** the platform super admin decides which modules (Students, Attendance, Exams, Fees, …) and which tool variants (manual vs biometric attendance, …) each organization gets.
- **Role-based access:** each organization defines roles and scopes (organization, institution, campus, section) for its staff, parents and students.

> Status: **Phase 1 (foundation).** Start with the documents below.

## Getting started

Prerequisites: Node.js 24 LTS (see `.nvmrc`), pnpm 10 (`corepack enable`), PostgreSQL 18 installed locally. Docker is not needed for now ([ADR-0012](docs/adr/0012-local-development-without-docker.md)).

```sh
copy .env.example .env    # then put your Postgres password in DATABASE_ADMIN_URL
pnpm install
pnpm db:setup             # once: creates the database roles and the "eduplatform" database
pnpm dev                  # builds shared packages, runs migrations, starts API, worker, device gateway
pnpm test                 # unit and architecture tests
pnpm test:integration     # database tests (tenant isolation, audit, outbox)
```

| URL | What |
|---|---|
| http://localhost:3000/api/docs | Swagger UI (API documentation) |
| http://localhost:3000/api/docs/openapi.json | The API contract the frontend copies with `pnpm api:sync` |
| http://localhost:3000/api/v1/health | API health |
| http://localhost:3002/health | Device gateway health |

Postman: import `packages/contracts/postman/eduplatform.postman_collection.json` and `packages/contracts/postman/local.postman_environment.json`.

New to the project? Read, in order: [project structure](docs/guides/project-structure.md) → [getting started](docs/guides/getting-started.md) → [adding a service](docs/guides/adding-a-service.md).

## Target institution types (in priority order)

1. Junior / intermediate colleges (11th–12th, groups such as MPC, BiPC, CEC, MEC)
2. Degree and engineering colleges (programs, branches, semesters, credits)
3. Schools (classes and sections)

## Documents

| # | Document | What it answers |
|---|---|---|
| 1 | [Product requirements](docs/01-product-requirements.md) | Who uses it, what v1/v2/v3 contain, what "done" means |
| 2 | [Domain map](docs/02-domain-map.md) | Which modules exist, what data each owns, how they talk |
| 3 | [Tenancy and academic structure](docs/03-tenancy-and-academic-structure.md) | Organization → institution → campus hierarchy, data isolation, academic templates |
| 4 | [Roles and permissions](docs/04-roles-and-permissions.md) | Permission naming, scopes, default roles, the permissions matrix |
| 5 | [Module catalog](docs/05-module-catalog.md) | Module manifests, variants ("tools"), dependencies, entitlement rules |
| 6 | [Roadmap](docs/06-roadmap.md) | Build phases, exit checks, open decisions |
| 7 | [Database design](docs/07-database-design.md) | Conventions, database roles, RLS, cross-module references |
| 8 | [API conventions](docs/08-api-conventions.md) | Paths, headers, pagination, errors, Swagger and Postman |
| — | [Module documentation](docs/modules/) | Per module: purpose, permissions, tables, endpoints, events, facade, rules |
| — | [Guides](docs/guides/) | Project structure, getting started, adding a service, running one service, deployment |
| — | [Architecture decisions](docs/adr/) | Why the architecture looks the way it does |

## Repository layout ([ADR-0011](docs/adr/0011-microservice-ready-services.md), [ADR-0013](docs/adr/0013-separate-frontend-and-backend-repositories.md))

Every folder is explained in [docs/guides/project-structure.md](docs/guides/project-structure.md).

```
services/             one package per business service (audit, and more each phase)
apps/
  api/                host: runs every service listed in src/services.ts
  worker/             background jobs: outbox relay, imports, notifications, reports
  device-gateway/     receives biometric device punches
packages/
  server-kit/         tenant context, database, guards, outbox, audit, logging
  contracts/          OpenAPI + event schemas, Swagger, Postman collection
  config/             shared TypeScript settings
infra/
  database/           database roles script (used by pnpm db:setup and the tests)
  docker/             Docker Compose: on hold (ADR-0012)
docs/
```

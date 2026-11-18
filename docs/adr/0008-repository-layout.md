# ADR-0008: Repository layout with separate backend and frontend folders; Node.js 24

Status: Accepted
Date: 2026-09-28

Refines the folder paths used in [ADR-0004](0004-monorepo-stack.md). ADR-0004's technology choices are unchanged.

## Context

The project owner wants backend and frontend code in two clearly separate folders. ADR-0004 and docs 2 and 5 used a flat `apps/` folder. The frontend must still share generated API types with the backend, so that a changed API shape breaks the frontend build instead of production.

## Decision

- One pnpm workspace at the repository root, spanning both folders. One lockfile, one `pnpm dev`, one CI pipeline.
- Layout:

  ```
  backend/
    apps/api/              NestJS modular monolith
    apps/worker/           outbox relay and background jobs
    apps/device-gateway/   biometric punches
    packages/server-kit/   tenant context, database, guards, outbox, audit, logging
  frontend/
    apps/web/              institutions, parents, students
    apps/admin/            super admin console
    packages/ui/           design system
  packages/                shared by both sides
    contracts/             OpenAPI, event schemas, generated types, Postman collection
    config/                tsconfig, eslint, prettier
  infra/docker/            local environment
  docs/
  ```

- Frontend packages may import only from `packages/*` and `frontend/*`; backend packages only from `packages/*` and `backend/*`. A lint rule enforces this.
- **Runtime:** Node.js 24 LTS, pinned in `.nvmrc`, `package.json` `engines`, CI and Docker images.

## Consequences

- Paths in docs 2 (§2.5) and 5 (§5.6) change from `apps/api/...` to `backend/apps/api/...` and from `apps/web/...` to `frontend/apps/web/...`.
- Either side can later move to its own repository by publishing `packages/contracts` as a versioned package.

## Alternatives considered

- **Two independent projects** (separate lockfiles and CI): cleaner separation, but contracts must be published or copied between them and two dependency sets kept in sync. Too much overhead for two developers.

# ADR-0012: Local development without Docker for now; PostgreSQL 18

Status: Accepted
Date: 2026-09-29

Supersedes the "Local environment" line of [ADR-0004](0004-monorepo-stack.md) until Docker is brought back. The rest of ADR-0004 is unchanged.

## Context

ADR-0004 planned Docker Compose for the local environment. The project owner prefers not to depend on Docker for now and already runs PostgreSQL 18 locally. Phase 1 needs only PostgreSQL; Keycloak, Redis and MinIO are first needed in Phase 2.

## Decision

- Developers use a **locally installed PostgreSQL 18**.
  - `pnpm db:setup` creates the project's roles (`infra/database/roles.sql`) and the `eduplatform` database, using a superuser connection from `DATABASE_ADMIN_URL` in the repository's `.env` file.
  - `pnpm db:migrate` creates the tables.
- **Integration tests** create a throw-away database on the same server for each test file and drop it afterwards. CI runs them against a PostgreSQL 18 service container provided by GitHub Actions.
- **PostgreSQL 18** is the target version in development, CI and production. It satisfies ADR-0002's "16 or newer".
- `infra/docker/` is kept, marked on hold, for when Keycloak, Redis and MinIO are needed. Whether they then run in Docker or as local installs is decided at the start of Phase 2.

## Consequences

- No Docker needed to build, run or test Phase 1.
- Each developer's `.env` holds their own Postgres superuser password; it is never committed.
- Phase 2 must revisit this ADR before adding Keycloak.

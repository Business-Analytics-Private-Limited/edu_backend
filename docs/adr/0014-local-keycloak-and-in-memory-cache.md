# ADR-0014: Keycloak installed locally; in-memory cache until Redis is needed

Status: Accepted
Date: 2026-09-29

Completes [ADR-0012](0012-local-development-without-docker.md), which left the Phase 2 services open. Does not change [ADR-0003](0003-identity-keycloak.md) (Keycloak for authentication).

## Context

Phase 2 adds login (Keycloak) and the permission checks that doc 4 §4.1 caches in Redis. Docker stays on hold. Keycloak runs on Java (installed: Java 25). Redis has no official Windows build. In Phase 2 the API is a single process, and no service consumes another service's events yet.

## Decision

- **Keycloak runs locally from its official zip**, managed by `infra/keycloak`:
  - `pnpm keycloak:install` downloads and unpacks the pinned version into `.local/keycloak-<version>/` (git-ignored).
  - `pnpm dev` starts it with the other processes in development mode on http://localhost:8080 and imports the `platform` and `tenants` realms from `infra/keycloak/realms/`.
  - Development mode stores Keycloak's own data in its built-in file database under `.local/`, separate from our PostgreSQL. Production uses its own PostgreSQL database (ADR-0003).
- **Caching of entitlement and permission checks is in-memory** inside the API process, behind a small cache interface in server-kit, with a short time-to-live (60 s) and immediate invalidation when the same process changes the data.
- **Redis is introduced** (behind the same interface, plus BullMQ for the worker) as soon as either happens: a service consumes another service's events, or the API runs as more than one process. At that point this ADR is revisited, including whether Redis runs from Docker or a Windows-compatible server.

## Consequences

- No Docker needed in Phase 2.
- With an in-memory cache, a permission change made in one API process is seen by another process only after the time-to-live. That is acceptable while there is one process, and the reason Redis becomes mandatory before scaling out.
- Keycloak's development data (realms, test users) lives in `.local/` and can be reset by deleting that folder.

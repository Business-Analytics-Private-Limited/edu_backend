# Infrastructure

| Folder | What it is | Status |
|---|---|---|
| `database/roles.sql` | Creates the five database roles (ADR-0009). Used by `pnpm db:setup`, the integration tests, and Docker | In use |
| `docker/` | Docker Compose for Postgres, Redis, Keycloak, MinIO, Mailpit, plus Keycloak realm files | **On hold** ([ADR-0012](../docs/adr/0012-local-development-without-docker.md)) |

Local development uses your installed PostgreSQL 18: see [docs/guides/getting-started.md](../docs/guides/getting-started.md).

Everything in this folder is for development and tests. Production infrastructure is decided in Phase 7.

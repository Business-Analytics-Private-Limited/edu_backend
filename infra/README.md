# Infrastructure

| Folder | What it is | Status |
|---|---|---|
| `database/roles.sql` | Creates the five database roles (ADR-0009). Used by `npm run db:setup`, the integration tests, and Docker | In use |
| `keycloak/` | Local Keycloak (login server): install/start script and the `platform` and `tenants` realms. Started by `npm run dev` | In use ([ADR-0014](../docs/adr/0014-local-keycloak-and-in-memory-cache.md)) |
| `docker/` | Docker Compose for Postgres, Redis, Keycloak, MinIO, Mailpit | **On hold** ([ADR-0012](../docs/adr/0012-local-development-without-docker.md)) |

Local development uses your installed PostgreSQL 18: see [docs/guides/getting-started.md](../docs/guides/getting-started.md).

Everything in this folder is for development and tests. Production infrastructure is decided in Phase 7.

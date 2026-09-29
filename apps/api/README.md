# API host

`@eduplatform/api` runs every backend service in one process ([ADR-0011](../../docs/adr/0011-microservice-ready-services.md)). It holds almost no business code; that lives in `services/`.

| Path | What it is |
|---|---|
| `src/main.ts` | Starts the app |
| `src/services.ts` | **The list of services this host can run.** Add a service here. `ENABLED_SERVICES` picks a subset ([running one service](../../docs/guides/running-one-service.md)) |
| `src/app.module.ts` | Root NestJS module: database, health checks, services, global access guard |
| `src/configure-app.ts` | The HTTP pipeline every request goes through (security headers, CORS, body limit, error format, Swagger) |
| `src/config.ts` | Settings from environment variables, checked at startup |
| `src/db/` | Connection pool, `db:setup`, `db:migrate`, the list of migration sources |
| `src/system/` | Health endpoints |
| `test/architecture/` | Rules checked without a database: every endpoint has a guard and matches the contract; services stay inside their boundaries |
| `test/integration/` | Rules checked on a real database: tenant isolation, audit, outbox, HTTP pipeline |
| `test/fixtures/sample/` | A test-only sample service; its migration is the pattern for every tenant table |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Watch mode on http://localhost:3000 |
| `pnpm db:setup` | Creates roles and the database on your local Postgres (needs `DATABASE_ADMIN_URL`) |
| `pnpm db:migrate` | Applies migrations of every service |
| `pnpm test` | Architecture tests |
| `pnpm test:integration` | Database tests on a throw-away database |

Endpoints: http://localhost:3000/api/v1/… · Swagger: http://localhost:3000/api/docs

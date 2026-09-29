# Backend services

One package per business service ([ADR-0011](../docs/adr/0011-microservice-ready-services.md)). Each owns one Postgres schema, one manifest, its own migrations and its own endpoints.

| Service | Package | Phase | Documentation |
|---|---|---|---|
| audit | `@eduplatform/audit-service` | 1 | [docs/modules/audit.md](../docs/modules/audit.md) |
| platform | `@eduplatform/platform-service` | 2 | [docs/modules/platform.md](../docs/modules/platform.md) |
| identity, access, files | — | 2 | [docs/modules/](../docs/modules/) |
| academic | — | 3 | [docs/modules/academic.md](../docs/modules/academic.md) |
| students | — | 4 | [docs/modules/students.md](../docs/modules/students.md) |
| attendance | — | 5 | [docs/modules/attendance.md](../docs/modules/attendance.md) |
| portal | — | 6 | [docs/modules/portal.md](../docs/modules/portal.md) |
| imports | — | 4 / 7 | [docs/modules/imports.md](../docs/modules/imports.md) |

## Rules

1. A service reads and writes only its own schema.
2. It uses another service only through `@eduplatform/<name>-service/public`, or by consuming its events. Lint and an architecture test enforce this.
3. Its `public/` folder is its contract with other services: keep it small and stable. It normally holds:
   - a facade interface (for example `StudentsFacade` with `getStudent(id)`),
   - the DTO types that interface returns,
   - the injection token other services use to receive the facade.
4. Every endpoint declares `@RequireModule` and `@RequirePermission`.
5. Every write records an audit entry, and emits an outbox event if other services care.

How to create one: [docs/guides/adding-a-service.md](../docs/guides/adding-a-service.md).

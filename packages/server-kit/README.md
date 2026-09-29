# server-kit

`@eduplatform/server-kit`: shared plumbing for every backend app and service. No business logic. It makes the rules in `CLAUDE.md` easy to follow and hard to break.

| Folder | Gives you | Rule it supports |
|---|---|---|
| `context/` | `runWithContext`, `requireTenantId`: who the current request is for, available anywhere | Tenant resolution (doc 3 §3.2) |
| `db/transaction.ts` | `withTenantTransaction(pool, fn)`: runs queries with `app.tenant_id` set, so Row-Level Security applies | Rule 1 |
| `db/migrations.ts` | `runMigrations`: applies each service's SQL files once, in order, with checksums | Rule 6 |
| `auth/` | `KeycloakTokenVerifier` (signature, realm, audience, expiry of Keycloak tokens) and `KeycloakAuthenticator` (token → our own active user, through an `IdentityResolver`) | ADR-0003 |
| `access/` | `@RequireModule`, `@RequirePermission`, `@Public`, `@AuthenticatedOnly`, `@PlatformEndpoint`, and the global `AccessGuard`: login first, then module and permission, deny by default | Rule 3 |
| `audit/` | `recordAudit(tx, …)`: audit entry in the same transaction, secrets redacted | Rule 9 |
| `outbox/` | `publishEvent(tx, …)` in the same transaction; `OutboxRelay` for the worker | Rule 8 |
| `errors/`, `http/` | `NotFoundError`, `ValidationError`, …; `ProblemFilter` turns them into RFC 9457 responses; request-id middleware | docs/08 §8.6 |
| `logging/` | `createLogger`: JSON logs with request, tenant and user ids; personal data redacted | ADR-0004, DPDP |
| `service/` | `ServiceDefinition`: what every service exports | ADR-0011 |
| `config/` | `loadLocalEnv`: reads the repository's `.env` in development | ADR-0012 |
| `ids.ts` | `newId()`: UUIDv7 | Rule 5 |
| `../migrations/` | Foundation migration: `app.current_tenant_id()`, used by every RLS policy | ADR-0002 |

A typical write in a service:

```ts
await withTenantTransaction(this.pool, async (tx) => {
  await tx.client.query('update students.students set … where id = $1', [id]);
  await recordAudit(tx, { moduleKey: 'students', entityType: 'students.student', entityId: id, action: 'update', before, after });
  await publishEvent(tx, 'students', { type: 'students.student.updated', subject: id, dataSchema: 'students.student.updated/1', data: { studentId: id } });
});
```

Tests: `pnpm test` (unit). The database behaviour is tested in `apps/api/test/integration/`.

# Audit service

`@eduplatform/audit-service`: the append-only record of who changed what, when and why. Full design: [docs/modules/audit.md](../../docs/modules/audit.md).

This is also the **reference layout** for every service.

| Path | What it is |
|---|---|
| `src/index.ts` | `auditService`, the ServiceDefinition the host app registers |
| `src/manifest.ts` | Permissions (`audit.log.view`), navigation, events (none) |
| `src/audit.module.ts` | NestJS wiring; controllers arrive in Phase 2 |
| `src/public/` | What other services may import (nothing yet) |
| `migrations/0001_entries.sql` | Table `audit.entries`: partitioned by month, RLS per tenant, insert and select only |

## How other services write audit entries

They don't import this service. They call the writer from server-kit inside their own transaction, so the change and its audit entry are saved together or not at all:

```ts
import { recordAudit, withTenantTransaction } from '@eduplatform/server-kit';

await withTenantTransaction(pool, async (tx) => {
  // … the business change …
  await recordAudit(tx, {
    moduleKey: 'students',
    entityType: 'students.student',
    entityId: student.id,
    action: 'update',
    before,
    after,
  });
});
```

## Status

- Phase 1: table and writer, tested in `apps/api/test/integration/database.int.test.ts`.
- Phase 2: `GET /api/v1/audit/entries` for tenant admins.

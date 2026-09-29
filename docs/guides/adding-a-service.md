# Adding a service

Every business module is a service package in `services/<name>/` ([ADR-0011](../adr/0011-microservice-ready-services.md)). `services/audit` is the reference; copy its shape.

Example below: `students`.

## 1. Document it first

- The module document `docs/modules/students.md` must exist and be agreed.
- Add its endpoints to `packages/contracts/openapi/students.yaml` (mark unbuilt ones `x-planned: true`) and run `pnpm contracts:build`.

## 2. Create the package

```
services/students/
  package.json          copy from audit; rename to @eduplatform/students-service
  tsconfig.json         copy from audit
  tsconfig.build.json   copy from audit
  README.md             what it does; link to docs/modules/students.md
  migrations/
    0001_students.sql
  src/
    index.ts            exports studentsService: ServiceDefinition
    manifest.ts         key: 'students', permissions, events, navigation
    students.module.ts  NestJS module
    public/index.ts     what other services may use (facade interface, DTO types)
    http/               controllers
    application/        use cases
    domain/             entities, rules
    infrastructure/     repositories
    events/             event handlers
```

## 3. Write the migration

Every tenant table follows the pattern in `apps/api/test/fixtures/sample/migrations/0001_notes.sql`:

- `tenant_id uuid not null`, `unique (tenant_id, id)`, an index starting with `tenant_id`;
- RLS **enabled and forced**, with the `tenant_isolation` policy;
- grants to `edu_app` only for what the service needs;
- an `outbox` table if the service publishes events.

The integration tests fail if any of this is missing.

## 4. Register it in the host

`apps/api/src/services.ts`:

```ts
import { studentsService } from '@eduplatform/students-service';

export const ALL_SERVICES = [auditService, /* … */ studentsService];
```

and add `"@eduplatform/students-service": "workspace:*"` to `apps/api/package.json`, then `pnpm install`.

## 5. Write endpoints

Every controller method declares its guard, or the architecture test fails:

```ts
@Get()
@RequireModule('students')
@RequirePermission('students.student.view')
list() { … }
```

Inside use cases:

```ts
await withTenantTransaction(this.pool, async (tx) => {
  // 1. the business write
  // 2. recordAudit(tx, { … })             CLAUDE.md rule 9
  // 3. publishEvent(tx, 'students', { … }) CLAUDE.md rule 8
});
```

## 6. Test it

- Unit tests next to the code (`*.test.ts`).
- A tenant-isolation test: data created in tenant A is invisible from tenant B (CLAUDE.md rule 4).

## 7. Using another service

```ts
import type { AcademicFacade } from '@eduplatform/academic-service/public';   // allowed
import { NodeRepository } from '@eduplatform/academic-service';                // blocked by lint
```

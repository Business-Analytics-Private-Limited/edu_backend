# Module: audit

| | |
|---|---|
| Schema | `audit` |
| Phase | 1 (writer and table), 2 (viewing endpoints) |
| Depends on | none |
| Code | `services/audit/`; writer in `packages/server-kit/src/audit/` |

## Purpose

An append-only record of who changed what, when, from where, and why (ADR-0005, CLAUDE.md rule 9).

## Responsibilities

- Storing audit entries in the same transaction as the change they describe.
- Showing a tenant its audit log, including platform staff impersonation.
- Platform-level audit for super admin actions.
- Redacting personal data on a DPDP erasure request.

## Manifest

- Always enabled.
- Settings (organization level): `retention.years` (default 7).

## Permissions

| Permission | Allows |
|---|---|
| `audit.log.view` | Read the tenant's audit log within scope |

## Data model

```
audit.entries                           partitioned by range (occurred_at), monthly
  id              uuid not null
  tenant_id       uuid not null
  occurred_at     timestamptz not null
  actor_type      text check (user | platform_user | system | device)
  actor_id        uuid
  impersonator_id uuid                  platform user acting as actor_id
  module_key      text not null
  entity_type     text not null         'students.student'
  entity_id       uuid not null
  action          text not null         create | update | delete | restore | a domain verb
  changes         jsonb          [P]   { "field": [before, after] }, changed fields only
  reason          text
  request_id      text
  ip              inet           [P]
  user_agent      text
  redacted_at     timestamptz           set when personal data was erased
  primary key (id, occurred_at)
  index (tenant_id, entity_type, entity_id, occurred_at desc)
  index (tenant_id, actor_id, occurred_at desc)

audit.platform_entries                  super admin actions; no RLS; edu_platform only
  same columns, with target_tenant_id uuid (nullable) instead of tenant_id
```

Grants: `edu_app` has `insert, select` on `audit.entries` and nothing on `platform_entries`. No runtime role has `update` or `delete`.

Secrets are never recorded: fields named like `password`, `secret`, `token` are removed from `changes` by the writer.

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/audit/entries` | `audit.entry.list` | `audit.log.view` | `?entityType&entityId&actorId&action&from&to`, newest first |
| GET | `/audit/entries/{entryId}` | `audit.entry.get` | `audit.log.view` | One entry with its full change set |
| GET | `/admin/audit/entries` | `admin.audit.list` | `admin.tenant.view` | Platform entries, filterable by tenant |

## Events

None published or consumed.

## Public facade

Modules don't call a facade; they use the server-kit writer inside their transaction:

```ts
await audit.record(tx, {
  entityType: 'students.student', entityId, action: 'update',
  before, after, reason,
});   // actor, tenant, request id, IP come from the request context
```

## Business rules

1. Every create, update and delete of business data writes an entry in the same transaction. If the audit insert fails, the change fails.
2. Entries are never updated or deleted, except redaction for erasure, run by a maintenance function under `edu_owner` that also writes an entry recording the redaction.
3. Partitions older than the retention setting are detached and archived, not deleted, until the retention period ends.

## Tests

- `edu_app` can't update or delete an audit row (permission error).
- A service that changes a student and then throws leaves neither the change nor an audit entry.
- Password-like fields never appear in `changes`.

## Open questions

- None.

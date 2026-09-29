# ADR-0009: Database roles and cross-tenant access paths

Status: Proposed
Date: 2026-09-28

## Context

ADR-0002 says the application connects without `BYPASSRLS`. Three jobs need to reach data before or across tenant contexts: the outbox relay (reads unsent events of all tenants), the super admin console (lists and edits tenants' entitlements), and the device gateway (knows only a device serial when a punch arrives). Giving any of them a role that bypasses RLS would put every tenant's data one bug away from a leak.

## Decision

Separate login roles, none of which has `BYPASSRLS` at runtime:

| Role | Purpose | Cross-tenant path |
|---|---|---|
| `edu_owner` | Migrations only; owns all objects | Has `BYPASSRLS`; never used by a running service |
| `edu_app` | API tenant endpoints, worker jobs | None. Every transaction sets `app.tenant_id`. Insert/select only on `audit`. |
| `edu_platform` | API super admin endpoints | A policy `to edu_platform using (true)` on tenant tables **of schema `platform` only** |
| `edu_relay` | Outbox relay | A policy `to edu_relay using (true)` on `<schema>.outbox` tables; column-level `update` on relay fields only |
| `edu_gateway` | Device gateway | `execute` on the security-definer function `attendance.resolve_device(serial)`; then works under the resolved tenant context |

Tenant context is read through `app.current_tenant_id()`, which raises an error when the setting is missing or empty.

Details: [doc 7 §7.3–7.4](../07-database-design.md).

## Consequences

- The API keeps two connection pools (`edu_app`, `edu_platform`); a super admin endpoint cannot accidentally use the tenant pool's context, and a tenant endpoint cannot see other tenants' platform rows.
- CI tests check that no runtime role has `BYPASSRLS` or owns a table.

## Alternatives considered

- **One application role with `BYPASSRLS` for background work:** simplest, but any bug in a job leaks across tenants. Rejected.
- **Relay runs with a tenant context per tenant:** needs a loop over every tenant and scales poorly. Rejected.

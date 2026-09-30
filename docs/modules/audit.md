# Module: audit (who changed what, where, when)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/audit/` |
| Table | `audit_logs` |
| Decisions | ADR-0015, ADR-0018 |

## What it does

Every create, update and delete of business data writes one row to `audit_logs`, **in the same database transaction** as the change (both are saved, or neither):

| Column | Example |
|---|---|
| `actor_type`, `actor_id`, `actor_name` | `user`, …, `Ravi Kumar` (or `super_admin`) |
| `action`, `entity`, `entity_id` | `update`, `campus`, … |
| `organization_id` | the organization (empty for super admin actions on the platform itself) |
| `institution_id`, `campus_id` | where it happened, if in one institution / campus |
| `details` | what changed, e.g. `{ "name": "Kukatpally Campus" }` — never passwords |
| `created_at` | when |

```ts
await this.audit.log(db, user, {
  action: 'update', entity: 'campus', entityId: id,
  institutionId, campusId,                 // the place, so local admins see it
  details: { ...dto },
});
```

## Reading it

`GET /api/v1/audit-logs?page=&pageSize=` with `audit.log.view`:
- with the permission for the whole organization: every entry of the organization;
- a Principal / Campus admin: only entries of their institution / campus.

The web app's **Audit log** page shows who (by name), where, what and when.

## Later

Filters (by person, place, date, entity), export, and keeping logs for a set number of years.

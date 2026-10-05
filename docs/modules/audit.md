# Module: audit (who changed what, where, when)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/audit/` |
| Table | `audit_logs` |
| Decisions | ADR-0015, ADR-0018, ADR-0027 (mandatory, add-only, logins and downloads) |

## What it does

Every create, update and delete of business data writes one row to `audit_logs`, **in the same database transaction** as the change (both are saved, or neither). It is **mandatory**: `audit-coverage.spec.ts` fails when a method changes data without logging (ADR-0027). It is **add-only**: the app's database role can't change or delete entries.

Also recorded: every **login** and **failed login** (with the reason), every **password change**, and every **document download** (staff and portal).

| Column | Example |
|---|---|
| `actor_type`, `actor_id`, `actor_name` | `user`, …, `Ravi Kumar` (or `super_admin`; `unknown` with no id for a failed login with an unknown email) |
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

`GET /api/v1/super-admin/audit-logs?organizationId=&action=&page=&pageSize=` (super admin): every organization's entries and the platform's own (`organizationId=platform`), with the organization's name. The console's **Audit log** page shows it with filters, e.g. *login failed*.

## Later

More filters (by person, place, date) in the web app, export, a retention rule (how many years to keep entries), and the browser's IP address on logins.

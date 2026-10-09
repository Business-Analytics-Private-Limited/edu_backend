# 3. Tenancy and academic structure

> **Note (2026-10-09): replaced by [ADR-0030](adr/0030-organization-branches-and-academic-engine.md).** Today an organization has ONE type and several **branches** (no institutions or campuses); levels come from the type; sections belong to a branch. The rest of this document is the original design.
>
> **Earlier note (2026-10-05):** institutions no longer have a type, and only the super admin adds them ([ADR-0025](adr/0025-institutions-by-super-admin-without-types.md)). Where this document mentions institution types or templates per type, every institution now starts with Class → Section and sets up its own levels.

## 3.1 Tenant hierarchy

```
Platform (us)
└── Organization  = TENANT  (e.g. "Sri Vidya Educational Society")
    │   tenant_id lives here; data isolation boundary; billing unit
    ├── Institution (type: junior_college | degree_college | engineering_college | school)
    │   │   e.g. "Sri Vidya Junior College"
    │   ├── Campus  (e.g. "Kukatpally", "Ameerpet")
    │   │     └── academic structure nodes (year → group → section …)
    │   └── Campus …
    └── Institution …
```

| Level                     | Why it exists                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organization (tenant)** | The unit of isolation, entitlement and billing. A single-institute customer is simply an organization with one institution.                  |
| **Institution**           | Has a type, and the type decides the academic template. It has its own settings (time zone, attendance policy), and can narrow module usage. |
| **Campus**                | A physical location. Used for scoping staff, devices and reports. Every institution has at least one campus.                                 |

## 3.2 Data isolation

**Model:** "pool" by default and "silo" when needed ([ADR-0002](adr/0002-postgresql-rls-multitenancy.md)).

1. Every tenant-owned table has `tenant_id uuid not null`, indexed and first in composite indexes.
2. Row-Level Security is **enabled and forced** on each such table:
   ```sql
   alter table students.students enable row level security;
   alter table students.students force row level security;
   create policy tenant_isolation on students.students
     using (tenant_id = current_setting('app.tenant_id')::uuid)
     with check (tenant_id = current_setting('app.tenant_id')::uuid);
   ```
3. The API connects as a role **without** `BYPASSRLS`. Each request runs in a transaction that begins with `select set_config('app.tenant_id', $1, true)`. If the setting is missing, queries fail instead of returning all rows.
4. Platform-level tables (plans, module catalog, the tenant registry itself) have no `tenant_id`. The super admin app uses a separate database role.
5. **Institution and campus scoping** (who can see which institution inside a tenant) is enforced in the application by the access module. RLS covers only the tenant boundary.
6. **Silo option:** `platform.tenant_placements` records which database cluster holds each tenant. The connection resolver reads it, so a large tenant can move to a dedicated database with no code change.

### Tenant resolution per request

1. The user logs in through Keycloak and receives a token with `sub` (user) and `org` (tenant id).
2. The API validates the token and confirms that `sub` is an active member of `org`.
3. The tenant context (tenant id, user id, active institution, resolved scopes) goes into AsyncLocalStorage for the request.
4. The database layer applies `app.tenant_id` from that context.

A user who belongs to two organizations (rare, for example a consultant) picks one after login and gets a token for that organization.

## 3.3 Academic structure engine

The academic hierarchy is **not hard-coded**. Each institution type has a **template** that defines the levels. The institution then creates **nodes** that follow the template.

### Tables (schema `academic`)

| Table                 | Purpose                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `structure_templates` | Platform-provided (read-only for tenants): `junior_college_v1`, `degree_v1`, `engineering_v1`, `school_v1`                        |
| `structure_levels`    | Ordered levels per template, e.g. `year` → `group` → `section`; flags such as `is_enrolment_level` (students enrol at this level) |
| `structure_nodes`     | Tenant data: a tree per institution and campus (`parent_id`, `level_key`, `code`, `name`, `sort_order`, `is_active`)              |
| `academic_years`      | Per institution: `2026-27`, start and end dates, `status` (planned / active / closed)                                             |
| `node_year_offerings` | Which nodes run in which academic year (e.g. a new group added in 2027-28)                                                        |
| `subjects`            | Per institution; linked to nodes (group MPC → Maths, Physics, Chemistry …)                                                        |

### Templates

| Template                     | Levels (top → enrolment level)                                  | Extra concepts                                                                                                   |
| ---------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `junior_college_v1` (**v1**) | Year (1st / 2nd) → Group (MPC, BiPC, CEC, MEC, HEC …) → Section | Batch / coaching stream (EAMCET, NEET, JEE long-term) as a **tag**, student category (day scholar / residential) |
| `degree_v1` (v3)             | Program → Year → Semester → Section                             | Credits, electives, CGPA                                                                                         |
| `engineering_v1` (v3)        | Program (B.Tech) → Branch (CSE, ECE …) → Semester → Section     | Regulation (R22 …), credits, electives, CGPA                                                                     |
| `school_v1` (v3)             | Class (Nursery–10) → Section                                    | House, stream for 11–12 if the school has them                                                                   |

**Promotion** runs between years: 1st-year MPC section A in 2026-27 → 2nd-year MPC in 2027-28. It is defined per template as a rule ("move to the next node at the same `group`, same or re-assigned section") and runs as a bulk operation with preview and undo.

**Why this matters:** supporting degree, engineering and schools later means adding a template, not rewriting the Students or Attendance modules. Those modules only know "a student is enrolled in a node in an academic year".

## 3.4 Settings inheritance

Settings resolve in this order, with the most specific level winning:

```
module default (manifest)  →  organization  →  institution  →  campus
```

Example: the attendance mode is `manual` for the organization but `biometric` for campus "Kukatpally". The super admin's entitlement is the outer limit: a campus can't choose `biometric` unless the organization is entitled to it.

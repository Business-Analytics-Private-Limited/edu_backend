# Module: platform (organizations, institutions, campuses, modules)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/super-admin/` (super admin side), `src/modules/organization/` (organization side) |
| Tables | `organizations`, `modules`, `organization_modules`, `institutions`, `campuses` |
| Decisions | ADR-0015 (simple backend), ADR-0018 (places), ADR-0025 (institutions by the super admin, no type) |

## What it is for

EduPlatform serves many **organizations** (a school group, a college society, a trust). Each organization has one or more **institutions** (a junior college, a school), added **only by the super admin**, and each institution has one or more **campuses** (branches), added by the organization. Institutions have **no type**: each sets up its own class levels, and every feature works the same for all of them (ADR-0025). The super admin decides which **modules** (Academic, Students, Attendance, …) each organization has.

```
Organization  "Sri Vidya Educational Society"
 ├─ Institution  "Sri Vidya Junior College" (SVJC)
 │   ├─ Campus  "Kukatpally" (KKP)
 │   └─ Campus  "Ameerpet"   (AMP)
 └─ Institution  "Sri Vidya Degree College" (SVDC)
     └─ Campus  "Main"       (MAIN)
```

## Super admin side (`/api/v1/super-admin/...`, super admins only)

| Method | Path | What it does |
|---|---|---|
| GET | `/super-admin/dashboard` | Numbers across all organizations, newest organizations |
| GET | `/super-admin/modules` | The module list |
| GET | `/super-admin/organizations?search=&status=&page=&pageSize=` | List and search |
| POST | `/super-admin/organizations` | Create an organization **with its first admin and its institutions** (`institutions: [{ name, code }]`, at least one); it also gets every predefined role |
| GET | `/super-admin/organizations/:id` | Details, admins, institutions, modules (on/off) |
| PATCH | `/super-admin/organizations/:id` | Edit name and contact details |
| POST | `/super-admin/organizations/:id/suspend` / `activate` | A suspended organization's users can't log in (takes effect at once) |
| PUT | `/super-admin/organizations/:id/modules/:moduleKey` | `{ enabled }`: switch a module on/off; a module needs the modules it depends on (`src/modules/super-admin/module-rules.ts`) |
| POST | `/super-admin/organizations/:id/institutions` | `{ name, code }`: add an institution; it starts with the levels Class → Section |
| DELETE | `/super-admin/organizations/:id/institutions/:institutionId` | Delete an institution while it is empty (no campuses, roles or academic data) |

## Organization side (`/api/v1/...`, organization users)

| Method | Path | Permission | Checked at |
|---|---|---|---|
| GET | `/dashboard` | any user | numbers for the user's own places |
| GET | `/organization` | `platform.organization.view` | |
| PATCH | `/organization` | `platform.organization.update` | whole organization |
| GET | `/institutions` | `platform.institution.view` | lists only institutions / campuses in reach |
| GET | `/institutions/:id` | `platform.institution.view` | only campuses in reach are included |
| PATCH | `/institutions/:id` | `platform.institution.update` | that institution; `{ name }` only |
| POST | `/institutions/:id/campuses` | `platform.campus.create` | that institution |
| PATCH | `/campuses/:id` | `platform.campus.update` | that campus |
| DELETE | `/campuses/:id` | `platform.campus.delete` | that campus; refused while staff have roles there |

"Checked at" = the user needs the permission **at that place** (see [access.md](access.md) and ADR-0018): a Campus admin can rename their campus but not another one.

## Rules

1. An organization only ever sees its own data: every query filters by organization, and PostgreSQL row security blocks anything missed (`organization_id` on every organization table).
2. Institution codes are unique in the organization; campus codes are unique in the institution (capital letters, digits, `_`, `-`).
3. Every change is written to the audit log with its place.

## Later

- Settings per institution / campus (time zone, academic calendar style, attendance variant).
- Soft delete instead of delete once institutions have students.

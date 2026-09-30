# Module: platform (organizations, institutions, campuses, modules)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/super-admin/` (super admin side), `src/modules/organization/` (organization side) |
| Tables | `organizations`, `modules`, `organization_modules`, `institutions`, `campuses` |
| Decisions | ADR-0015 (simple backend), ADR-0018 (places) |

## What it is for

EduPlatform serves many **organizations** (a school group, a college society, a trust). Each organization has one or more **institutions** (a junior college, a school), and each institution has one or more **campuses** (branches). The super admin decides which **modules** (Academic, Students, Attendance, …) each organization has.

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
| POST | `/super-admin/organizations` | Create an organization **with its first admin**; it also gets every predefined role |
| GET | `/super-admin/organizations/:id` | Details, admins, modules (on/off) |
| PATCH | `/super-admin/organizations/:id` | Edit name and contact details |
| POST | `/super-admin/organizations/:id/suspend` / `activate` | A suspended organization's users can't log in (takes effect at once) |
| PUT | `/super-admin/organizations/:id/modules/:moduleKey` | `{ enabled }`: switch a module on/off; a module needs the modules it depends on (`src/modules/super-admin/module-rules.ts`) |

## Organization side (`/api/v1/...`, organization users)

| Method | Path | Permission | Checked at |
|---|---|---|---|
| GET | `/dashboard` | any user | numbers for the user's own places |
| GET | `/organization` | `platform.organization.view` | |
| PATCH | `/organization` | `platform.organization.update` | whole organization |
| GET | `/institutions` | `platform.institution.view` | lists only institutions / campuses in reach |
| POST | `/institutions` | `platform.institution.create` | whole organization |
| GET | `/institutions/:id` | `platform.institution.view` | only campuses in reach are included |
| PATCH | `/institutions/:id` | `platform.institution.update` | that institution |
| DELETE | `/institutions/:id` | `platform.institution.delete` | that institution; refused while it has campuses or staff |
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

# Module: platform (organizations, their type and branches, modules)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/super-admin/` (super admin side), `src/modules/organization/` (organization side) |
| Tables | `organizations`, `modules`, `organization_modules`, `branches` |
| Decisions | ADR-0015 (simple backend), ADR-0030 (organization → branches, organization type), ADR-0026 (close instead of delete) |

## What it is for

EduPlatform serves many **organizations** (a school group, a college society, a trust). Each organization:
- **is one type:** School, Intermediate, Degree or Engineering. The type decides its academic structure (see [academic.md](academic.md)). A management with a school *and* a junior college uses two organizations.
- **has one or more branches:** its locations. Only the **super admin** adds, closes and deletes them; the organization can rename them.
- **has a short code,** e.g. "SVJC", used in admission numbers.

The super admin also decides which **modules** (Academic, Students, Attendance, …) each organization has.

```
Organization  "Sri Vidya Junior College"  (type Intermediate, code SVJC)
 ├─ Branch  "KPHB"      (KPHB)
 ├─ Branch  "Ameerpet"  (AMP)
 └─ Branch  "Vijayawada" (VJA)
```

## Super admin side (`/api/v1/super-admin/...`, super admins only)

| Method | Path | What it does |
|---|---|---|
| GET | `/super-admin/dashboard` | Numbers across all organizations, newest organizations |
| GET | `/super-admin/modules` | The module list |
| GET | `/super-admin/organizations?search=&status=&page=&pageSize=` | List and search |
| POST | `/super-admin/organizations` | Create an organization **with its type, code, first admin and branches** (`branches: [{ name, code }]`, at least one). It also gets every predefined role and what its type always has (Intermediate: Junior, Senior, Long Term). |
| GET | `/super-admin/organizations/:id` | Details, admins, branches, modules (on/off) |
| PATCH | `/super-admin/organizations/:id` | Name, code, contacts. The **type** can change only while the organization has no academic structure and no students. |
| POST | `/super-admin/organizations/:id/suspend` / `activate` | A suspended organization's users can't log in (takes effect at once) |
| PUT | `/super-admin/organizations/:id/modules/:moduleKey` | `{ enabled }`: switch a module on/off; a module needs the modules it depends on (`src/modules/super-admin/module-rules.ts`) |
| POST | `/super-admin/organizations/:id/admins/:userId/reset-password` | A new temporary password for one of the organization's admins, answered once (ADR-0036); e.g. when the only admin forgot theirs |
| POST | `/super-admin/organizations/:id/branches` | `{ name, code }`: add a branch |
| POST | `/super-admin/organizations/:id/branches/:branchId/deactivate` | Close a branch: records stay, nothing new happens there, roles there stop working. Refused while current students study there. |
| POST | `/super-admin/organizations/:id/branches/:branchId/activate` | Open it again |
| DELETE | `/super-admin/organizations/:id/branches/:branchId` | Delete an empty branch only (no staff roles, sections, students or holidays) |

## Organization side (`/api/v1/...`, organization users)

| Method | Path | Permission | Checked at |
|---|---|---|---|
| GET | `/dashboard` | any user | numbers for the user's own branches (or all) |
| GET | `/organization` | `platform.organization.view` | details, type, level names and settings |
| PATCH | `/organization` | `platform.organization.update` | whole organization (contact details) |
| GET | `/branches` | `platform.branch.view` | only branches in reach, with their current students |
| GET | `/branches/:id` | `platform.branch.view` | that branch |
| PATCH | `/branches/:id` | `platform.branch.update` | that branch; `{ name }` only |

"Checked at" = the user needs the permission **at that place** (see [access.md](access.md)): a Branch admin sees their own branch only.

## Rules

1. An organization only ever sees its own data: every query filters by organization, and PostgreSQL row security blocks anything missed (`organization_id` on every organization table).
2. Branch codes are unique in the organization (capital letters, digits, `_`, `-`).
3. Every change is written to the audit log with its branch.
4. **Branches are closed, not deleted** (ADR-0026):
   - a closed branch keeps its records, which can still be read
   - nothing new happens there (`places-in-use.ts`)
   - roles given there stop working until it is opened again
   - only the super admin closes and reopens branches
5. **Settings that apply to the whole organization** live on it: weekly off days, time zone, attendance correction window, admission numbering.

# 4. Roles and permissions

## 4.1 How access is decided

A request is allowed only if **all four** checks pass:

| # | Check | Owner | Example failure |
|---|---|---|---|
| 1 | **Entitlement**: the module (and variant, if relevant) is enabled for the tenant | Platform super admin | Tenant has no Attendance module |
| 2 | **Configuration**: the variant is switched on for this organization or branch | Organization admin | The branch uses manual, but the request is a biometric device sync |
| 3 | **Permission**: one of the user's roles grants the permission | Tenant admin (roles) | Teacher tries `students.student.delete` |
| 4 | **Scope**: the target data is inside the scope of that role assignment | Tenant admin (assignment) | Teacher of section 1A tries to mark attendance for 1B |

Checks 1 and 2 come from the platform module (cached in Redis, invalidated by `platform.*` events). Checks 3 and 4 come from the access module (cached per user, invalidated by `access.*` events).

## 4.2 Permission naming

`module.resource.action`

- Actions: `view`, `create`, `update`, `delete`, plus domain verbs (`mark`, `correct`, `promote`, `import`, `export`, `approve`).
- Each module declares its permissions in its manifest. On startup the access module syncs the catalog.
- A permission belonging to a module the tenant is not entitled to is ignored, even if a role contains it.

## 4.3 Scopes

A role is **assigned** to a user **at a scope**. The same role can be assigned at different scopes.

| Scope type | Meaning |
|---|---|
| `organization` | All branches of the organization |
| `branch` | One branch |
| `node` | One academic node and its descendants (e.g. group MPC, or section 1A) |
| `self` | Only the user's own records (students) |
| `guardian` | Only records of students linked to this guardian (parents) |

Example: Ms. Rao has the role *Teacher* at scope `node: 1st-year MPC section A` and at scope `node: 2nd-year MPC section B`.

### Tables (schema `access`)

`permissions(key, module_key, description)` · `roles(id, tenant_id, key, name, is_system_template, based_on)` · `role_permissions(role_id, permission_key)` · `role_assignments(id, tenant_id, user_id, role_id, scope_type, scope_id, valid_from, valid_to)`

**Built so far (ADR-0018, ADR-0030):** `organization` and `branch` scopes, as a place on each role assignment (`user_roles.branch_id`; empty = whole organization). Parent and Student logins are linked to student records (`guardian` / `self`). `node` is not built yet.

## 4.4 Platform roles (outside tenants)

| Role | Can do |
|---|---|
| `platform_owner` | Everything, including managing platform staff |
| `platform_admin` | Onboard and suspend tenants, plans, entitlements, limits, feature flags |
| `platform_support` | Read tenant configuration; impersonate with a stated reason (time-limited, audited, visible to the tenant) |

Platform users are in a separate Keycloak realm and never appear in tenant user lists.

## 4.5 Predefined roles (ADR-0017)

Every organization has these roles. Each is given to a user **at a place** (the whole organization, or one branch); see ADR-0030. The **super admin sets their default permissions** (super admin console, *Predefined roles*); a change applies to that role in every organization at once. Organization admins **assign** them to users and may **change their permissions for their own organization** (ADR-0029): that copy is then *customized* and keeps the organization's choice when the super admin changes the role, until the organization resets it. Names can't change and predefined roles can't be deleted. Organization admin (always everything), Parent and Student stay locked. For anything else organizations **create their own roles**.

| Role | Given by | Typical scope (planned) | Starting permissions |
|---|---|---|---|
| Organization admin | organization | organization | Everything, always (can't be changed, even by the super admin) |
| Director | organization | organization | Every *view* in every branch, with filters by branch / class / group / stream / section; export students (branches are added by the super admin only) |
| Principal | organization | branch | Everything a Branch admin can do, plus promotion, organization settings view and attendance rules |
| Branch admin | organization | branch | Runs one branch: its staff, sections, students, documents and attendance (not roles) |
| Senior faculty | organization | node (classes) | View academics and students, mark and correct attendance, attendance reports |
| Junior faculty | organization | node (classes) | View academics and students, mark attendance |
| DTP operator | organization | branch | Data entry: create/edit/import students and documents, no delete |
| Parent | student record | guardian | View their children's profile, documents, attendance |
| Student | student record | self | View their own profile, documents, attendance |

> **Sensitive student details** (ADR-0031): `students.sensitive.view` shows Aadhaar, reservation category, sub-caste and medical condition. Branch admin and Principal have it, the Director too (every view); faculty and DTP operators don't. Without it the Aadhaar is masked and the rest hidden. In a database made before this permission existed, the super admin uses **Reset to EduPlatform defaults** on those roles.

> **Branches:** only the super admin adds, closes, reopens and deletes branches (ADR-0030). The organization can rename them (`platform.branch.update`).

> **One person, several roles:** a person who is both Principal and Branch admin of KPHB simply holds both roles there; their permissions add up.

> **New predefined roles:** the super admin can also create a new predefined role (*Predefined roles → New predefined role*); every organization gets it. Only roles the super admin created can be deleted again.

The starting permissions are in `src/modules/roles/predefined-roles.ts`; after that, the database (`role_templates`) is the source of truth.

**Parent and Student** are not given from the Users page. Their logins will be created from a student's record (Students module), linked to that student, so a parent sees only their own children and a student only themselves. Until then the API refuses to assign them.

## 4.6 Several roles per user

A user has **one or more roles** (`user_roles`). They may do everything any of their roles allows. Example: a principal who also teaches has *Principal* and *Senior faculty*.

Permissions are shown as a grid: one row per resource, a checkbox per action (**View, Create, Edit, Delete**, plus special actions such as Mark, Correct, Import, Export, Promote, Transfer). The full list is in `src/modules/roles/permissions.ts`.

## 4.7 Rules

- Deny by default: no permission means no access.
- There are no hidden "super user" roles inside a tenant. The org admin role is an ordinary role with many permissions.
- Every role or assignment change is audited, with who changed it and why.
- An organization must always keep at least one active **Organization admin**. The API refuses to deactivate the last one or take that role away from them.
- **Nobody can hand out more than they have:** a role you create or edit, and every role you give a user, must be within your own permissions; you can't change a role or a user that has permissions you don't have.
- Predefined roles can only be changed by the super admin; organization admins get 403 when they try.

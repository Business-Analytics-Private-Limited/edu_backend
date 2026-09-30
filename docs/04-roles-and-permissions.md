# 4. Roles and permissions

## 4.1 How access is decided

A request is allowed only if **all four** checks pass:

| # | Check | Owner | Example failure |
|---|---|---|---|
| 1 | **Entitlement**: the module (and variant, if relevant) is enabled for the tenant | Platform super admin | Tenant has no Attendance module |
| 2 | **Configuration**: the variant is switched on for this institution or campus | Institution admin | Campus uses manual, but the request is a biometric device sync |
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
| `organization` | All institutions in the tenant |
| `institution` | One institution, all campuses |
| `campus` | One campus |
| `node` | One academic node and its descendants (e.g. group MPC, or section 1A) |
| `self` | Only the user's own records (students) |
| `guardian` | Only records of students linked to this guardian (parents) |

Example: Ms. Rao has the role *Teacher* at scope `node: 1st-year MPC section A` and at scope `node: 2nd-year MPC section B`.

### Tables (schema `access`)

`permissions(key, module_key, description)` · `roles(id, tenant_id, key, name, is_system_template, based_on)` · `role_permissions(role_id, permission_key)` · `role_assignments(id, tenant_id, user_id, role_id, scope_type, scope_id, valid_from, valid_to)`

**Built so far (ADR-0018):** `organization`, `institution` and `campus` scopes, as a place on each role assignment (`user_roles.institution_id` / `campus_id`). `node`, `self` and `guardian` come with the Academic and Students modules.

## 4.4 Platform roles (outside tenants)

| Role | Can do |
|---|---|
| `platform_owner` | Everything, including managing platform staff |
| `platform_admin` | Onboard and suspend tenants, plans, entitlements, limits, feature flags |
| `platform_support` | Read tenant configuration; impersonate with a stated reason (time-limited, audited, visible to the tenant) |

Platform users are in a separate Keycloak realm and never appear in tenant user lists.

## 4.5 Predefined roles (ADR-0017)

Every organization has these roles. Each is given to a user **at a place** (whole organization, one institution, or one campus); see ADR-0018. **Only the super admin changes their permissions** (super admin console, *Predefined roles*), and a change applies to that role in every organization at once. Organization admins can **assign** them to users but can't change or delete them; for anything else they **create their own roles**.

| Role | Given by | Typical scope (planned) | Starting permissions |
|---|---|---|---|
| Organization admin | organization | organization | Everything, always (can't be changed, even by the super admin) |
| Director | organization | organization | Every *view*, plus create/edit institutions and campuses, export students |
| Principal | organization | institution | Academics, students (no delete), promotion/transfer, attendance corrections and rules |
| Campus admin | organization | campus | Runs one campus: its staff, students, documents and attendance (not roles, not institutions) |
| Senior faculty | organization | node (classes) | View academics and students, mark and correct attendance, attendance reports |
| Junior faculty | organization | node (classes) | View academics and students, mark attendance |
| DTP operator | organization | institution or campus | Data entry: create/edit/import students and documents, no delete |
| Parent | student record | guardian | View their children's profile, documents, attendance |
| Student | student record | self | View their own profile, documents, attendance |

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

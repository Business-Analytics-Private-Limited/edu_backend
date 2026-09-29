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

## 4.4 Platform roles (outside tenants)

| Role | Can do |
|---|---|
| `platform_owner` | Everything, including managing platform staff |
| `platform_admin` | Onboard and suspend tenants, plans, entitlements, limits, feature flags |
| `platform_support` | Read tenant configuration; impersonate with a stated reason (time-limited, audited, visible to the tenant) |

Platform users are in a separate Keycloak realm and never appear in tenant user lists.

## 4.5 Default tenant role templates

New tenants receive these as editable copies.

| Role | Typical scope |
|---|---|
| Organization admin | organization |
| Institution admin (principal / dean) | institution |
| Office staff | institution or campus |
| Campus in-charge | campus |
| Teacher / lecturer | node |
| Accountant (v2) | institution or campus |
| Parent | guardian |
| Student | self |

## 4.6 v1 permissions matrix

✓ = granted by default. Tenant admins can change their copies.

| Permission | Org admin | Inst admin | Office staff | Campus in-charge | Teacher | Parent | Student |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **platform (tenant side)** | | | | | | | |
| `platform.institution.view` | ✓ | ✓ | ✓ | ✓ | | | |
| `platform.institution.manage` | ✓ | | | | | | |
| `platform.campus.manage` | ✓ | ✓ | | | | | |
| `platform.settings.manage` | ✓ | ✓ | | | | | |
| **access** | | | | | | | |
| `access.user.view` | ✓ | ✓ | ✓ | ✓ | | | |
| `access.user.manage` | ✓ | ✓ | | | | | |
| `access.role.manage` | ✓ | ✓ | | | | | |
| `audit.log.view` | ✓ | ✓ | | | | | |
| **academic** | | | | | | | |
| `academic.structure.view` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `academic.structure.manage` | ✓ | ✓ | | | | | |
| `academic.year.manage` | ✓ | ✓ | | | | | |
| `academic.subject.manage` | ✓ | ✓ | | | | | |
| `academic.calendar.manage` | ✓ | ✓ | | | | | |
| **students** | | | | | | | |
| `students.student.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `students.student.create` | ✓ | ✓ | ✓ | | | | |
| `students.student.update` | ✓ | ✓ | ✓ | | | | |
| `students.student.delete` | ✓ | ✓ | | | | | |
| `students.student.import` | ✓ | ✓ | ✓ | | | | |
| `students.student.export` | ✓ | ✓ | ✓ | ✓ | | | |
| `students.enrolment.promote` | ✓ | ✓ | | | | | |
| `students.enrolment.transfer` | ✓ | ✓ | ✓ | | | | |
| `students.document.view` | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `students.document.manage` | ✓ | ✓ | ✓ | | | | |
| `students.settings.manage` | ✓ | ✓ | | | | | |
| **attendance** | | | | | | | |
| `attendance.record.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `attendance.record.mark` | | ✓ | ✓ | ✓ | ✓ | | |
| `attendance.record.correct` | | ✓ | | ✓ | | | |
| `attendance.policy.manage` | ✓ | ✓ | | | | | |
| `attendance.device.manage` | ✓ | ✓ | | ✓ | | | |
| `attendance.report.view` | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| **imports** | | | | | | | |
| `imports.job.view` | ✓ | ✓ | ✓ | | | | |

For parents and students, `view` permissions are always limited to their `guardian` or `self` scope, whatever the matrix says.

## 4.7 Rules

- Deny by default: no permission means no access.
- There are no hidden "super user" roles inside a tenant. The org admin role is an ordinary role with many permissions.
- Every role or assignment change is audited, with who changed it and why.
- A tenant must always keep at least one active user with `access.role.manage`. The API blocks removing the last one.

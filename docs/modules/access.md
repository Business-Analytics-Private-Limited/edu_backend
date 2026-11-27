# Module: access (login, users, roles, permissions)

| | |
|---|---|
| Status | **Built** |
| Code | `src/modules/auth/`, `src/modules/users/`, `src/modules/roles/`, `src/common/scope.ts`, `src/common/guards/` |
| Tables | `super_admins`, `users`, `roles`, `role_templates`, `user_roles` |
| Decisions | ADR-0015 (JWT login), ADR-0017 (predefined roles, several roles), ADR-0018 (places) |
| Design | [docs/04-roles-and-permissions.md](../04-roles-and-permissions.md) |

## In one paragraph

People log in with email and password and get a token (JWT, 8 hours). **Super admins** (EduPlatform staff) use the super admin console. **Users** belong to one organization and are **staff** (roles and permissions, below) or **portal logins** of parents and students (no roles; see [portal.md](portal.md) and ADR-0022). A user has one or more **roles**, each **at a place**: the whole organization, or one branch (ADR-0030). A role is a list of **permissions** such as `students.student.update`. A user may do what their roles allow, in each role's place.

## Login

| Method | Path | Who |
|---|---|---|
| POST | `/auth/super-admin/login` | super admins |
| POST | `/auth/login` | organization users |
| GET | `/auth/me` | anyone logged in: who you are, `roleNames`, `permissions` (anywhere) and `grants` (each role with its place), `enabledModules` |
| POST | `/auth/change-password` | anyone logged in; ends their other sessions |
| POST | `/auth/logout` | anyone logged in; ends this session at once |
| POST | `/auth/two-factor/setup`, GET `/auth/two-factor/pending`, POST `/auth/two-factor/enable`, `/disable` | super admins: two-step login |

Every request reloads the user, so deactivating a user or suspending an organization works at once. Passwords are stored as bcrypt hashes. The first super admin is created by `npm run db:seed` from `SEED_SUPER_ADMIN_*` in `.env`; no screen can create super admins.

**Login security (ADR-0028):**
- Every login is a **session** (`login_sessions`), and a token works only while its session is open: logging out ends it, and a password change ends the other sessions.
- **5 failed logins** in a row lock the account for 15 minutes.
- A **temporary password** (from an admin or the seed) must be changed before anything else: `mustChangePassword` in `/auth/me`, and AccessGuard answers 403 "Change your temporary password first".
- **Super admins** can turn on **two-step login**: a 6-digit code from an authenticator app; the secret is stored encrypted.
- Rate limits and the audit log use the **visitor's address**, which the web apps forward (`TRUST_PROXY`).

## Permissions

`module.resource.action`, with actions **view, create, update (Edit), delete** plus special ones (mark, correct, import, export, promote, transfer). The full list is `src/modules/roles/permissions.ts`; screens show it as a grid. A permission of a module the organization doesn't have does nothing.

## Roles

**Predefined roles** (every organization has them). The super admin sets their default permissions for all organizations at once. An organization may change a role's permissions for itself (`PATCH /roles/:id` with `{ permissions }`); its copy is then **customized** and the super admin's later changes skip it until `POST /roles/:id/reset` (ADR-0029). Locked: Organization admin, Parent, Student.

| Role | Usually given at | |
|---|---|---|
| Organization admin | whole organization (always) | everything, can't be changed (not even by the organization) |
| Director | whole organization | sees everything in every branch, with filters by branch / class / group / stream / section |
| Principal | a branch | runs the branch: everything a Branch admin can do, plus promotion and attendance rules |
| Branch admin | a branch | runs the branch: staff, sections, students, documents, attendance |
| Senior faculty / Junior faculty | a branch | teaching, attendance (Junior: fewer rights) |
| DTP operator | a branch | data entry, no delete |
| Parent / Student | from a student's record | not given from the Users page |

Starting permissions: `src/modules/roles/predefined-roles.ts`; afterwards the database (`role_templates`) is the source of truth.

**Own roles**: an organization creates its own (with the permission for the whole organization).

| Method | Path | Permission |
|---|---|---|
| GET | `/permissions` | `access.role.view` |
| GET | `/roles`, `/roles/:id` | `access.role.view` |
| POST / PATCH / DELETE | `/roles`, `/roles/:id` | `access.role.create` / `update` / `delete`, **whole organization**; own roles only (predefined: 403) |
| GET | `/super-admin/permissions`, `/super-admin/predefined-roles` | super admin |
| PUT | `/super-admin/predefined-roles/:key` | super admin; not for Organization admin |

## Users and their roles

| Method | Path | Permission |
|---|---|---|
| GET | `/users?search=&status=` | `access.user.view` — only users with a role in your reach |
| POST | `/users` | `access.user.create` — `{ name, email, password, roles: [{ roleId, branchId? }] }` |
| GET | `/users/:id` | `access.user.view` |
| PATCH | `/users/:id` | `access.user.update` — name |
| POST | `/users/:id/deactivate` / `activate` | `access.user.update` |
| POST | `/users/:id/reset-password` | `access.user.update` — no body; answers `{ user, temporaryPassword }` once (ADR-0036) |
| POST | `/users/:id/roles` | `access.user.update` — `{ roleId, branchId? }` |
| DELETE | `/users/:id/roles/:assignmentId` | `access.user.update` |

Place: no `branchId` = whole organization; `branchId` = that branch only. One person may hold several roles, e.g. Principal AND Branch admin of KPHB.

## Rules (all tested in `test/organization.e2e-spec.ts` and `test/places.e2e-spec.ts`)

1. **Nobody hands out more than they have.** A role you create, and a role you give at a place, must be within your own permissions (at that place). You can't change a role or a user that has more than you.
2. **Places.** You see and manage users only in your places. Renaming or deactivating a user needs all their places to be yours (a teacher at two branches: each branch admin removes only their own branch's role).
3. The Organization admin role always applies to the whole organization, and every organization keeps at least one active Organization admin.
4. A user keeps at least one role; to block someone, deactivate them.
5. Predefined roles can't be changed or deleted by organizations; Parent / Student can't be given from the Users page.
6. Every change goes to the audit log.
7. **Password reset** (ADR-0036, `test/password-reset.e2e-spec.ts`): same reach rule as renaming. The API generates the temporary password (shown once, never logged); the person must change it at the next login, all their sessions end and a lockout is lifted. Not for yourself (use Change password).

## How to check a permission in new code

```ts
@RequirePermission('students.student.update')          // on the endpoint: has it SOMEWHERE?
...
if (!can(user, 'students.student.update', { branchId }))  // in the service: at the record's place?
  throw new ForbiddenException(...);
const reach = reachOf(user, 'students.student.view');  // to filter a list
```

## Later

Password reset by email, multi-factor login for admins, class-level places (faculty see only their classes), guardian / self places for parents and students.

# ADR-0017: Predefined roles managed by the super admin, several roles per user

Status: Accepted
Date: 2026-09-30

Refines ADR-0015 (roles) and docs/04-roles-and-permissions.md.

## Context

The project owner described the access model: the super admin owns the platform and creates organizations; each organization's admin manages its own users. Every organization should start with the same roles (Organization admin, Director, Principal, Senior faculty, Junior faculty, DTP operator, Parent, Student), whose permissions the super admin decides. Organization admins may add their own roles but must not change the predefined ones. One person often needs more than one role (a principal who also teaches). Permissions should be granted per action: view, create, edit, delete.

Until now every user had exactly one role, each organization had only an "Organization admin" role, and most permissions were a coarse "manage".

## Decision

- **Permissions** are `module.resource.action` with actions `view`, `create`, `update`, `delete` plus domain verbs (`mark`, `correct`, `import`, `export`, `promote`, `transfer`). The catalog is a list of resources with their actions (`src/modules/roles/permissions.ts`); screens show it as a grid.
- **Predefined roles** live in `role_templates` (platform table, no organization). Every organization has a **copy** of each in `roles` (with `template_key`), so users link only to roles of their own organization and row security stays as it is. When the super admin changes a template, every copy is updated in the same transaction. At startup the app creates missing templates and copies, and gives the Organization admin every permission, including new ones.
- **Organization admins** can assign predefined roles but get 403 when changing or deleting them. They create, edit and delete their **own** roles.
- **Several roles per user** (`user_roles`). A user's permissions are the union of their roles' permissions.
- **No escalation:** you can only put permissions you have into a role, only give roles within your permissions, and only change roles and users that don't have more than you.
- **Lock-out protection:** each organization keeps at least one active user with the Organization admin role.
- **Parent and Student** are predefined but not assignable from the Users page; they will be linked to student records by the Students module, which also brings scoped access (guardian / self).

## Consequences

- Every organization offers the same well-known roles; the super admin can tune them for everyone in one place.
- A copy per organization means one row per organization per predefined role; changing a template writes them all. Fine at the expected number of organizations.
- Scope (a principal limited to their institution, faculty to their classes) is **not** implemented yet: roles currently apply to the whole organization. It comes with role assignments per institution / campus / class.

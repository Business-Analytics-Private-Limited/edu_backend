# Module: access

| | |
|---|---|
| Schema | `access` |
| Phase | 2 |
| Depends on | platform, identity |
| Code | `services/access/` |

## Purpose

Decides checks 3 and 4 of every request: does one of the user's roles grant the permission, and is the target inside the scope of that role assignment (doc 4).

## Responsibilities

- Permission catalog, synced from every module's manifest at startup.
- Role templates (platform-provided) and tenant roles (editable copies).
- Role assignments at a scope, with validity dates.
- Resolving a user's effective permissions and scopes, cached in Redis per user.

Not this module: authentication (`identity` / Keycloak), module entitlement (`platform`).

## Manifest

- Always enabled.
- Settings: none.

## Permissions

| Permission | Allows |
|---|---|
| `access.role.manage` | Create, edit and delete roles; assign and revoke roles |
| `access.user.view` | View users' role assignments (also used by `identity`) |

## Data model

```
access.permissions                      platform-level; synced from manifests
  key             text pk               'students.student.create'
  module_key      text not null
  description     text not null
  synced_at       timestamptz not null

access.role_templates                   platform-level; copied to new tenants                [std]
  id uuid pk, key text unique, name text not null, description text,
  default_scope_type text check (organization | institution | campus | node | self | guardian)

access.role_template_permissions        platform-level
  template_id     uuid references access.role_templates
  permission_key  text references access.permissions
  primary key (template_id, permission_key)

access.roles                                                                                 [std][sd]
  id, tenant_id
  key             text not null         unique (tenant_id, key) where deleted_at is null
  name            text not null
  description     text
  based_on_template_key text

access.role_permissions
  tenant_id, role_id                    fk (tenant_id, role_id) → roles
  permission_key  text not null references access.permissions
  primary key (tenant_id, role_id, permission_key)

access.role_assignments                                                                      [std]
  id, tenant_id
  user_id         uuid not null         → identity.users
  role_id         uuid not null         fk (tenant_id, role_id) → roles
  scope_type      text check (organization | institution | campus | node | self | guardian)
  scope_id        uuid                  null for organization, self, guardian
  valid_from      timestamptz not null default now()
  valid_to        timestamptz
  reason          text
  revoked_at      timestamptz
  revoked_by      uuid
  revoke_reason   text
  check ((scope_type in ('organization','self','guardian')) = (scope_id is null))
  index (tenant_id, user_id) where revoked_at is null
```

## API

| Method | Path | operationId | Permission | Description |
|---|---|---|---|---|
| GET | `/access/permissions` | `access.permission.list` | `access.role.manage` | Catalog, limited to modules the tenant is entitled to |
| GET | `/access/role-templates` | `access.role_template.list` | `access.role.manage` | Platform templates |
| GET | `/access/roles` | `access.role.list` | `access.user.view` | Roles with permission counts |
| POST | `/access/roles` | `access.role.create` | `access.role.manage` | Create, optionally copying a template or another role |
| GET | `/access/roles/{roleId}` | `access.role.get` | `access.user.view` | One role with permissions |
| PATCH | `/access/roles/{roleId}` | `access.role.update` | `access.role.manage` | Rename, describe |
| PUT | `/access/roles/{roleId}/permissions` | `access.role.set_permissions` | `access.role.manage` | Replace the permission list |
| DELETE | `/access/roles/{roleId}` | `access.role.delete` | `access.role.manage` | Soft delete; blocked while assigned |
| GET | `/access/role-assignments` | `access.assignment.list` | `access.user.view` | `?userId&roleId&scopeType&scopeId` |
| POST | `/access/role-assignments` | `access.assignment.create` | `access.role.manage` | Assign a role at a scope, with reason |
| POST | `/access/role-assignments/{assignmentId}/revoke` | `access.assignment.revoke` | `access.role.manage` | Revoke with reason |
| GET | `/access/users/{userId}/effective-permissions` | `access.user.effective_permissions` | `access.user.view` | Resolved permissions and scopes, for support and debugging |

## Events

Published:

| Type | When | Data |
|---|---|---|
| `access.role.changed` | Role created, updated, permissions changed, deleted | `roleId, change` |
| `access.assignment.changed` | Assignment created or revoked | `assignmentId, userId, roleId, scopeType, scopeId, change` |

Consumed: `platform.module.disabled` (drops cached permissions of that module), `identity.user.deactivated` (drops the user's cache), `academic.node.updated` (node scope cache).

## Public facade

```ts
interface AccessFacade {
  // check 3 + 4 for one target; used by the guard and by services for row-level checks
  can(user: UserRef, permission: string, target?: ScopeTarget): Promise<boolean>;
  // for list endpoints: turns the user's scopes into filters the owning module applies
  scopeFilter(user: UserRef, permission: string): Promise<ScopeFilter>;
  effectivePermissions(userId): Promise<EffectivePermission[]>;
}

type ScopeTarget = { institutionId?; campusId?; nodeId?; nodeAncestorIds?; studentId? };
type ScopeFilter =
  | { kind: 'all' }                                  // organization scope
  | { kind: 'restricted'; institutionIds; campusIds; nodeIds; selfStudentIds; guardianStudentIds }
  | { kind: 'none' };
```

`guardian` and `self` scopes resolve through `StudentsFacade` (which students a guardian user is linked to; which student a student user is).

## Business rules

1. Deny by default.
2. A permission of a module the tenant isn't entitled to is ignored, even if a role contains it.
3. For parents and students, `view` permissions apply only at `guardian` or `self` scope, whatever the role says.
4. A tenant must always keep at least one active user with `access.role.manage`; revoking or deactivating the last one is blocked.
5. Every role or assignment change is audited with who and why; a reason is required for revocation.
6. Assignments outside `valid_from`–`valid_to` don't count.
7. New tenants receive copies of all active role templates.

## Tests

- A teacher assigned at node "1st-year MPC A" can mark attendance for that section and gets `404` for section B.
- A parent sees only their linked children, even if their role contains `students.student.view` at a broader scope.
- Revoking the last `access.role.manage` holder fails with `422`.
- Removing a permission takes effect on the next request (cache invalidated by the event).

## Open questions

- None.

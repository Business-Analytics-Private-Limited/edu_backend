# ADR-0029: Organizations may change the permissions of predefined roles

Status: Accepted
Date: 2026-10-08

Changes part of ADR-0017. Until now only the super admin changed predefined roles, and organizations could only assign them. The rest of ADR-0017 still applies: predefined roles exist in every organization, a user can have several roles, and the super admin manages the defaults.

## Context

The project owner: organizations work differently. In one, a Principal is more trusted than EduPlatform's default assumes; after a management meeting another organization needs to widen or narrow a role straight away. Waiting for EduPlatform, or rebuilding a predefined role as an own role and moving every user to it, is too slow.

## Decision

- **An organization may change the PERMISSIONS of its copy of a predefined role**: Director, Principal, Campus admin, Senior / Junior faculty, DTP operator.
  - It uses `PATCH /roles/:id` with `{ permissions }` and needs `access.role.update` for the whole organization.
  - The same rule as for own roles applies: only permissions you have yourself.
  - The name and description stay EduPlatform's, and predefined roles can't be deleted.
- **A changed copy is "customized"** (`roles.customized`):
  - The super admin's later changes to that predefined role skip it (`role_templates` → only copies with `customized = false`).
  - So does the sync when the API starts. The name and description are still updated.
- **Reset:** `POST /roles/:id/reset` puts EduPlatform's current permissions back and removes the mark, so the role follows the super admin again.
- **Locked completely:**
  - **Organization admin** always has every permission, so no organization can lock itself out.
  - **Parent and Student** describe portal logins, which have no permissions.
- **Screens**
  - **Organization:** the role page shows the permission grid for these roles, a *Customized* badge, and *Reset to EduPlatform defaults*.
  - **Super admin:** the console shows per predefined role how many organizations customized it, and the save button says which organizations it won't reach.
- Every change and reset is in the audit log (`update role` with `predefined: true`, `reset role`). The super admin's change records how many organizations were updated and how many kept their customization.
- Own roles: unchanged, still fully editable (name, description, permissions).
- **Found and fixed on the way:** a ticked box that is disabled in the grid wasn't sent with the form, so saving silently removed it. That happened for permissions of switched-off modules, and for permissions the editor doesn't have. Such boxes are now sent as hidden values.

## Consequences

- An improvement EduPlatform makes to a predefined role doesn't reach organizations that customized it. The super admin sees how many, and the organization sees EduPlatform's current permissions (`defaultPermissions`) to compare.
- "Principal" can mean different permissions in different organizations. Support must look at the organization's roles page, not assume the default.

## Alternatives considered

- **The super admin's change overwrites every organization.** Simpler, but an organization's decision would vanish without warning.
- **Only own roles, built by copying a predefined one.** Every user would have to be moved to the copy, and the copy loses EduPlatform's later improvements anyway.

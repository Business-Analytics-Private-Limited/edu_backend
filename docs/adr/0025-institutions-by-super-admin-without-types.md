# ADR-0025: Institutions are added by the super admin, and have no type

Status: Accepted
Date: 2026-10-05

Changes part of ADR-0019 (default class levels by institution type). The rest of ADR-0019 still applies.

## Context

Until now, an organization admin (and a Director) could add and delete institutions, and every institution had a type: junior college, degree college, engineering college or school. The type only decided the class levels a new institution started with (e.g. Year → Group → Section for a junior college).

The project owner decided:
- **Institutions are part of what an organization buys.** Only the super admin adds them: when creating the organization, and later on request.
- **There are no institution types.** Each institution sets up its own structure, and every feature works the same for every institution. A fixed list of types doesn't fit a general platform: coaching centres, international schools and colleges with unusual structures don't match any of the four.

## Decision

- **The super admin adds institutions:**
  - `POST /super-admin/organizations` needs `institutions: [{ name, code }]`, at least one.
  - `POST /super-admin/organizations/:id/institutions` adds one later.
  - `DELETE /super-admin/organizations/:id/institutions/:institutionId` deletes one, but only while it is empty: no campuses, no roles given there, no academic data.
  - Both are written to the audit log.
- **Organization users can view and rename institutions, and manage campuses:**
  - `POST /institutions` and `DELETE /institutions/:id` are removed.
  - The permissions `platform.institution.create` and `.delete` are removed from the catalog, from the predefined roles and from every organization's roles (migration `20261005090000_institutions_by_super_admin`).
- **No type:**
  - The `institutions.type` column and the `InstitutionType` enum are removed.
  - Every new institution starts with the levels **Class → Section**. The organization renames them, or chooses its own levels (Academic → Classes → Edit levels) before it creates classes.
- Shared code: `src/modules/organization/institution-records.ts` (add with starting levels, delete when empty).

## Consequences

- An organization that opens a new college asks EduPlatform to add it. This fits the commercial model: institutions are part of the subscription.
- A junior college now renames its starting levels (Class → Section) or sets Year → Group → Section itself, once, before building classes. The operating procedure says so.
- Codes are still unique in the organization, and still the institution's short name in admission numbers (`{CODE}`).
- When the backend becomes microservices (ADR-0024, proposed), adding institutions belongs with the Academic service, called by the super admin's console.

## Alternatives considered

- **Keep types, but let the super admin choose them.** Rejected by the owner: the type adds nothing once every institution sets its own levels.
- **Let organization admins add institutions as well.** Rejected by the owner: institutions are decided between EduPlatform and the customer.

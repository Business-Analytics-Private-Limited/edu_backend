# ADR-0018: Roles apply at a place (organization, institution or campus)

Status: Superseded

> Superseded by ADR-0030: roles now apply at the whole organization or one branch.

Date: 2026-09-30

Builds on ADR-0017. Implements the organization / institution / campus part of the scopes in docs/04-roles-and-permissions.md §4.3 (class-level and guardian / self scopes come with the Academic and Students modules).

## Context

An organization can have several institutions, each with several campuses. One Organization admin can't run all of them: each campus needs its own admin, who must only see and change their own campus. The owner also wants to know who changed what, and where.

## Decision

- **A role is given at a place.** `user_roles` gets `institution_id` and `campus_id`: both empty = the whole organization; `institution_id` = one institution and all its campuses; `campus_id` (+ its institution) = one campus. A user can have the same role at several places (a teacher at two campuses), so `user_roles` gets its own id.
- **New predefined role Campus admin**: runs one campus (its staff, and when built its students, documents and attendance). The Principal's starting permissions include everything a Campus admin has, so a principal can appoint campus admins.
- **Checks at the record's place** (`src/common/scope.ts`): the guard still checks that the user has the permission somewhere; services then check it at the place of the record (`can(user, permission, place)`) and filter lists to the user's reach (`reachOf`).
  - Users: you see users with a role in your reach; you give a role at a place only if you may manage users there AND have all of that role's permissions there; you rename / deactivate a user only if all their roles are in your reach.
  - Institutions and campuses: a campus admin sees their institution with only their campus.
  - Creating institutions, editing the organization, and creating / editing / deleting roles need the permission for the **whole organization**. Campus admins give existing roles only.
  - The Organization admin role always applies to the whole organization.
  - A user keeps at least one role; a campus or institution with staff assigned can't be deleted.
- **Audit log** stores the actor's name and the place (`actor_name`, `institution_id`, `campus_id`). A campus / institution admin sees the entries of their place; organization-wide admins see all.

## Consequences

- Campus admins and principals can run their part without seeing the rest of the organization.
- Every new module must record the place of its data (e.g. a student's campus) and check permissions at that place with the same helpers.
- The app doesn't overwrite predefined-role permissions already saved in the database (they are the super admin's decisions), so organizations created before this change keep their older Principal permissions until the super admin updates the role.

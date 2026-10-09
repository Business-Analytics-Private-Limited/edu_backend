# ADR-0026: Campuses and institutions are deactivated, not deleted

Status: Accepted

> Still applies, now to branches (ADR-0030); only the super admin closes and reopens them.

Date: 2026-10-06

## Context

Branches close, merge or pause, but their students' records, attendance, documents and audit history must stay for years. Until now a campus could only be deleted, and only while no staff had roles there. A campus with classes or students failed with an unclear error.

## Decision

- Campuses and institutions have a **status**, ACTIVE or INACTIVE (`PlaceStatus`, migration `20261006090000_place_status`).
- **Campus**
  - **Deactivate** (`POST /campuses/:id/deactivate`): needs `platform.campus.delete` at the campus. Refused while ACTIVE students still study there ("move them or change their status first").
  - **Activate** (`POST /campuses/:id/activate`): the **Organization admin only**, i.e. that role for the whole organization (`CurrentUser.isOrganizationAdmin`). Not possible while the institution is inactive.
  - **Delete** (`DELETE /campuses/:id`): the Organization admin only, and only for an **empty** campus (no staff roles, classes, students or holidays), e.g. one added by mistake.
- **Institution** (super admin only)
  - `POST /super-admin/organizations/:id/institutions/:institutionId/deactivate` and `/activate`.
  - Deactivating is refused while it has ACTIVE students.
  - Delete stays for an empty institution (ADR-0025).
- **What "inactive" means**
  - **Nothing new there:** `src/modules/organization/places-in-use.ts` refuses admission, import, placing in a section, promotion, campus transfer into it, new classes, marking attendance, new holidays, giving roles there, and new campuses in an inactive institution. A campus is in use only when it AND its institution are ACTIVE.
  - **Records stay readable:** students, attendance reports, documents and the audit log.
  - **Roles there stop working:** login (`jwt.strategy.ts`) leaves out roles given at an inactive campus or institution. They work again after activation.
  - **The code stays reserved:** a new campus can't take an inactive campus's code.
- **Screens**
  - Screens that start new work only offer places in use (`lib/places.ts` in the web app).
  - Screens that show data mark closed campuses "· inactive".
  - The dashboards count active and inactive separately.
- Every deactivation, activation and delete is in the audit log.

## Consequences

- Closing a branch never loses data, and it can be reopened.
- Before closing a campus, its active students must be moved (campus transfer) or given another status (transferred, discontinued, alumni).
- Someone who only had a role at a closed campus can still log in but sees nothing until it reopens, or until they get a role elsewhere.
- The permission key stays `platform.campus.delete`; on the roles screen it means "deactivate".

## Alternatives considered

- **Delete with all data.** Rejected: records must be kept.
- **Anyone with the permission may reactivate.** Rejected by the owner: reopening is the Organization admin's decision.

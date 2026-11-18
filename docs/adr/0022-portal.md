# ADR-0022: Parent and student portal — logins linked to records, no roles

Status: Accepted
Date: 2026-10-02

Builds on ADR-0017 (roles), ADR-0018 (places), ADR-0020 (students and guardians), ADR-0021 (attendance).

## Context

Parents want to see their children's details and attendance; students their own. A parent often has several children in the same organization. A portal login must never reach staff data, even by a mistake in a role or a forgotten check.

## Decision

- **A login has a kind** (`users.kind`): STAFF, PARENT or STUDENT. A PARENT login is linked to a **guardian** record (`users.guardian_id`), a STUDENT login to the **student** record (`users.student_id`); a database check keeps kind and link consistent; at most one login per guardian and per student.
- **What a portal login sees comes from the links, not from roles:** a parent sees every child of their guardian record (siblings with one login); a student sees themselves. Portal logins get **no roles, no permissions, no grants**.
- **Staff routes refuse portal logins** in the AccessGuard (`@OrganizationUser` and `@RequirePermission` are staff only); portal routes use `@PortalUser` (portal logins only, and only with the `portal` module).
- **Staff create and remove portal logins** from a student's page (`students.student.update` at the student's campus). Staff user lists show only staff.
- Email and password for now; login by phone with a one-time code needs an SMS provider (later).
- The predefined Parent / Student roles stay as descriptions only; they are not given to anyone.

## Consequences

- A portal login is safe by construction: it has nothing a staff endpoint accepts.
- Later: phone + OTP login, consent records for minors (DPDP), notices and fee details in the portal, a mobile app on the same `/portal` API.

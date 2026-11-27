# ADR-0036: Admin-issued password reset with a generated temporary password

Status: Accepted
Date: 2026-11-27

First item of the order of work in ADR-0035. Builds on ADR-0028 (forced password change, sessions, lockout).

## Context

A staff member who forgets their password, or who has locked their account with 5 wrong tries, has no way back in. The only fix today is to edit the database by hand, which CLAUDE.md forbids. If the organization's only admin forgets their password, the whole organization is stuck.

There is no mail provider yet, so "forgot password" by email can't be built now (ADR-0035).

## Decision

1. **An admin resets a staff member's password:** `POST /api/v1/users/:id/reset-password`, permission `access.user.update`, no request body.
   - The rule is the same as for changing a user's name or status: every role of the user must be within the admin's reach, with every permission of each role. A Branch admin resets their branch's staff; nobody resets someone who has more than they do. Whoever can reset a password can log in as that person, so this is the strictest rule we have.
   - Users the admin can't see (other branches, other organizations) answer 404, as everywhere.
   - Your own password: 400 "use Change password" (that needs your current password).
2. **The API generates the password; the admin doesn't type it.** 12 characters in three groups of four (e.g. `Kq7m-Xp3d-Rt9w`), from letters and digits that can't be confused (no 0/O, 1/l/I), always with a capital, a small letter and a digit: about 69 bits of randomness (`node:crypto` `randomInt`). Nobody picks a weak or reused password, and it is easy to read out over the phone.
3. **Shown once.** The answer carries `temporaryPassword` with `Cache-Control: no-store`. It is stored only as a bcrypt hash and is never written to the audit log or to any other log.
4. **What a reset does** (`src/modules/users/temporary-password.ts`, one transaction):
   - the old password stops working;
   - `must_change_password` is set, so the person must change it at the next login (ADR-0028; until then only who-am-I, change password and log out work);
   - a lockout from failed logins is lifted (often the reason for the call);
   - every open session of that person ends, so a forgotten logged-in computer or a stolen token is out as well.
5. **The super admin resets an organization admin:** `POST /api/v1/super-admin/organizations/:id/admins/:userId/reset-password`. Only for users with the Organization admin role in that organization; everyone else is reset by their own admins. This is the way out when the organization's only admin is locked out.
6. **Audit:** every reset is written as `reset password` on the user (ADR-0027), with the user's name and at the user's place, never the password.
7. **Frontend:** a "Reset password" button on the staff user's page (web app) and on each admin in the super admin console's organization page. The temporary password is shown once, with a copy button and a note to hand it over in person or by phone.

## Consequences

- A forgotten password no longer needs anyone to touch the database.
- The admin learns the temporary password, so they could log in as that person until it is changed. The audit log shows who reset it and when; the person's first login forces a new password that only they know.
- Parent and student logins (portal) are not covered: they are managed from the student's record. Their reset comes with the portal work.
- No schema change.
- "Forgot password" by email (a link with a one-time token) is added when a mail provider is chosen. It will reuse `issueTemporaryPassword`'s rules for sessions and lockout.
- Super admins can't reset each other's passwords here; with only a few super admins, that stays a manual step for now.
- With ADR-0024 (M2), this moves to the Identity service together with the rest of `auth` and `users`.

## Alternatives considered

- **The admin types the temporary password** (like creating a user): simpler, but admins reuse the same easy password (e.g. "Welcome@123") for everyone, which anyone in the institution can guess before the person logs in.
- **Email a reset link:** the right long-term way, but there is no mail provider yet (ADR-0035).
- **Keep the old password working until the new one is used:** then a reset can't stop someone who knows the old password; ending it at once is safer.

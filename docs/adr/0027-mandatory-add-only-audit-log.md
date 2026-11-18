# ADR-0027: The audit log is mandatory and add-only, and covers logins and document access

Status: Accepted
Date: 2026-10-06

## Context

Every data change already wrote an audit entry in the same transaction (ADR-0015, ADR-0018). A review found these gaps:
- **Logins** (successful and failed) and **password changes** were not recorded.
- **Document downloads** were not recorded. ID copies are sensitive.
- **The super admin couldn't see the log:** there was no page for it, and platform entries (predefined roles, super admin actions) were visible nowhere.
- **The table could be changed:** the app's database role could change or delete entries.
- **Nothing enforced the rule:** a new feature could forget to log, and nothing would notice.

## Decision

1. **Logins:** every attempt writes `login` or `login failed`, with the reason in `details`: unknown email, wrong password, account deactivated, organization suspended. The password is never stored.
   - A failed attempt is saved in its own transaction, so it stays although the request fails.
   - When the email belongs to nobody, the entry has `actor_type = 'unknown'` and no organization, so only the super admin sees it. `actor_id` may now be empty for this case.
2. **Password changes:** recorded as `change password` for staff, portal users and super admins.
3. **Document downloads:** recorded as `download document`, by staff and through the portal (`viaPortal: true`).
4. **Super admin page:** `GET /super-admin/audit-logs?organizationId=&action=` lists every entry of every organization, plus the platform's own (`organizationId=platform`), each with the organization's name. The console has an **Audit log** page with these filters.
5. **Add-only:** migration `20261006150000_audit_log_hardening` revokes UPDATE, DELETE and TRUNCATE on `audit_logs` from `edu_app`. The app can add and read entries, never change or remove them. Only the database owner, used for migrations, still can.
6. **Enforced by a test:** `src/modules/audit/audit-coverage.spec.ts` reads the source and fails when a method that changes data (`db.<table>.create / update / upsert / delete …`) doesn't write an audit entry. Helpers called by a method that already logs are listed in the test, each with the reason. The test also fails when that list goes stale.

## Consequences

- Password guessing shows up as `login failed` entries. Logins are also limited to 10 per minute per address.
- The log grows with every login and download. A retention rule (how many years to keep entries) is still to be decided.
- The web app logs people in from its own server, so the browser's IP address isn't recorded yet. It would need the web app to forward it.
- Viewing pages is not logged, only downloads and changes.
- Deleting an organization's data (done once by an administrator in development) must be done with the database owner role, outside the app.

## Alternatives considered

- **A database trigger instead of the test.** It catches every write, but it can't know who did it or where, and that's what the log is for.
- **Logging in the request middleware.** It sees every request, but not what changed or at which campus.

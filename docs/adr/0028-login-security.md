# ADR-0028: Login security: real visitor addresses, lockout, sessions, forced password change, two-step login

Status: Accepted
Date: 2026-10-07

## Context

A security review (2026-10-07) found:
1. **Rate limits were shared by everyone.** The web apps call the API from their own server, so the API saw one address for all visitors. The login limit (10 per minute) applied to everybody together: ten wrong passwords locked everyone out. The general limit (300 per minute) would block normal use with a few dozen users.
2. **The super admin kept the seeded password.** Nothing forced a change, and there was no second factor.
3. **No per-account lockout:** someone using many addresses could keep guessing one account's password.
4. **Tokens couldn't be withdrawn:** after logout or a password change, a copied token worked until it expired (8 hours).
5. **Outdated packages:** deepmerge-ts (Prisma), js-yaml (Swagger), PostCSS and source-map-js (Next.js), shell-quote.

## Decision

1. **The visitor's address**
   - The web apps forward it in `X-Forwarded-For` on every API call (`lib/api.ts`). Next.js sets it from the connection; in production the web server in front (nginx, ...) must set it.
   - The API believes that header only from `TRUST_PROXY` (Express "trust proxy"; default `loopback`, the same machine). So `request.ip` is the visitor and the throttler counts per visitor.
   - Logins record the address in the audit log.
2. **Account lockout**
   - 5 failed logins in a row (wrong password, or a wrong two-step code) lock the account for 15 minutes. Even the right password is refused during that time, and the answer says so.
   - A successful login resets the count. Every attempt is in the audit log.
   - An unknown email is checked against a dummy hash, so it answers as slowly as a wrong password.
3. **Sessions** (`login_sessions`)
   - Every login creates a session, and the token carries its id (`sid`). JwtStrategy accepts a token only while its session exists, belongs to that person, and hasn't ended or expired.
   - `POST /auth/logout` ends the session; the web apps call it when someone logs out.
   - Changing the password ends the account's other sessions; the current one goes on.
4. **Temporary passwords must be changed**
   - `must_change_password` is set for every new account (users, portal logins, seeded super admins) and for every account that existed when this was introduced.
   - Until it is changed, AccessGuard allows only "logged in" routes: who am I, change password, log out. Everything else answers 403 "Change your temporary password first".
   - The web apps send the person to `/change-password`. The new password must differ from the old one.
5. **Two-step login for super admins** (TOTP, RFC 6238; `otplib`)
   - Set up from the console's Account page: a QR code, then a 6-digit code to confirm. From then on, login needs the code as well.
   - Turning it off needs the password and a code.
   - The secret is stored encrypted with AES-256-GCM under `SECRETS_KEY` (`src/common/secret-box.ts`).
   - The console shows a warning while it is off.
6. **Packages**
   - npm `overrides` force patched versions: deepmerge-ts 8, js-yaml 5.4.3 under @nestjs/swagger, PostCSS 8.5.29 (also inside Next.js), source-map-js 1.2.2, shell-quote 1.12.
   - Both repositories' `npm audit --omit=dev` report 0 vulnerabilities.
   - Left: sprintf-js, a development tool dependency with no fixed version yet.

## Consequences

- `.env` needs `SECRETS_KEY`, and on a server `TRUST_PROXY` (the web apps' server addresses). The web server in front must set `X-Forwarded-For` to the real visitor; otherwise a visitor could choose their own address and dodge the per-address limit (the per-account lockout still applies).
- Someone can lock another person's account for 15 minutes by typing wrong passwords on purpose. The audit log shows who tried and from where.
- Every request now also reads its session row (by primary key).
- Old sessions stay in the table; a clean-up job (e.g. delete sessions ended more than 90 days ago) comes with the deployment work.
- Two-step login for organization users, and making it mandatory for super admins, are later decisions.

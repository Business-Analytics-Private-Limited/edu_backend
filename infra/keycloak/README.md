# Local Keycloak

The login server for development, run from Keycloak's official zip without Docker ([ADR-0014](../../docs/adr/0014-local-keycloak-and-in-memory-cache.md)).

| Command (repository root) | What it does |
|---|---|
| `pnpm keycloak:install` | Downloads and unpacks the pinned Keycloak version into `.local/` (once, about 200 MB) |
| `pnpm dev` | Starts Keycloak together with the API and the other processes |
| `pnpm keycloak` | Starts only Keycloak |

- Admin console: http://localhost:8080 (user `admin`, password `admin`, development only).
- Realms: `platform` (platform staff) and `tenants` (all tenant users), loaded from `realms/` the first time Keycloak starts.
- Needs Java 21 or newer (`java -version`).
- To reset (fresh realms, no test users): stop Keycloak and delete `.local/keycloak-<version>/data`.
- Emails (invitations, password reset) go to `localhost:1025`. Nothing listens there yet, so Keycloak reports the email as failed; a local mail catcher is added when Phase 2 needs it.

## What tokens contain

- `aud` includes **`eduplatform-api`**: an audience mapper on each client adds it, and the API refuses tokens without it.
- `organization`: the aliases of the organizations (tenants) the user belongs to, e.g. `["sri-vidya"]`. Keycloak adds it **only when the login requests the `organization` scope**, so tenant logins use `scope=openid organization`. Platform staff tokens don't have it.
- No roles or permissions: those come from our access service (ADR-0003).

| File | What it is |
|---|---|
| `keycloak.mjs` | The install and start script |
| `realms/tenants-realm.json` | Realm for tenant users: password policy, lockout, token lifetimes, clients `web` and `postman` |
| `realms/platform-realm.json` | Realm for platform staff: stricter policy, one-time-password (MFA) required, clients `admin` and `postman` |

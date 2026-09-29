# Deployment: frontend and backend on separate domains

The applications are built to be deployed independently, each on its own domain. Hosting provider is still an open decision (roadmap, Phase 7).

## Example

| Domain | What runs there | Package |
|---|---|---|
| `app.example.com` | Web app for institutions, parents, students | `eduplatform-frontend/apps/web` |
| `admin.example.com` | Super admin console (optionally IP-restricted) | `eduplatform-frontend/apps/admin` |
| `api.example.com` | API host with all services | `apps/api` |
| `devices.example.com` | Biometric device gateway (Phase 5) | `apps/device-gateway` |
| `auth.example.com` | Keycloak (Phase 2) | — |
| (no domain) | Worker | `apps/worker` |

## Why it works across domains

- The browser talks only to its own frontend domain. The Next.js server calls `api.example.com` server-to-server with the user's token (security baseline: tokens never reach browser JavaScript). Session cookies belong to the frontend domain only, so there are no cross-domain cookie problems.
- The API authenticates with bearer tokens, not cookies, so it doesn't care which domain the caller is on.
- If some browser code must call the API directly, list its origin in the API's `CORS_ORIGINS` setting, e.g. `CORS_ORIGINS=https://app.example.com,https://admin.example.com`. By default no browser origin is allowed.

## Settings per environment

| Where | Setting | Example |
|---|---|---|
| API | `DATABASE_APP_URL`, `CORS_ORIGINS`, `SWAGGER_ENABLED` | see `.env.example` |
| Web / admin (Phase 2) | `API_URL` (server-side only), Keycloak URL, client id and secret | `https://api.example.com/api/v1` |
| Keycloak (Phase 2) | Each client's redirect URIs and web origins | `https://app.example.com/*` |
| OpenAPI | a `servers` entry per environment, so Swagger and Postman target the right API | `packages/contracts/scripts/build.mjs` |

## Checklist before the first deployment (Phase 7)

- HTTPS on every domain, with HSTS.
- Production secrets from the hosting provider's secret manager, never `.env` files.
- Swagger off in production unless decided otherwise (`SWAGGER_ENABLED=false`, the default).
- Admin domain restricted (IP allowlist or VPN) if possible.
- Migrations run as `edu_owner` in the deploy pipeline, before the new API version starts.

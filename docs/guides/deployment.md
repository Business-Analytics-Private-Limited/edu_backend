# Deployment: frontend and backend on separate domains

The frontend apps and the API are deployed independently, each on its own domain. The hosting provider is still an open decision (roadmap, Phase 7).

## Example

| Domain | What runs there | Repository / folder |
|---|---|---|
| `app.example.com` | Web app for organization staff (and later parents, students) | `eduplatform-frontend/apps/web` |
| `admin.example.com` | Super admin console (optionally IP-restricted) | `eduplatform-frontend/apps/admin` |
| `api.example.com` | This API | `eduplatform-backend` (`npm run build`, then `npm run start`) |

## Why it works across domains

- The frontends log in by calling `POST /auth/login` (or `/auth/super-admin/login`) from their Next.js server, keep the token in an `httpOnly` cookie on their own domain, and send it to the API as `Authorization: Bearer <token>`. The browser's JavaScript never sees the token.
- The API accepts the token from any caller, so it doesn't matter which domain calls it.
- Browser code that calls the API directly must be allowed in `CORS_ORIGINS`, e.g. `CORS_ORIGINS=https://app.example.com,https://admin.example.com`.

## Settings per environment (API)

| Setting | Example |
|---|---|
| `DATABASE_URL` | the `edu_app` connection |
| `DIRECT_DATABASE_URL` | the `edu_owner` connection (migrations only) |
| `JWT_SECRET` | a long random value, different per environment, from the host's secret manager |
| `JWT_EXPIRES_IN` | `8h` |
| `CORS_ORIGINS` | the frontend domains |
| `PORT` | given by the host |
| `STORAGE_DIR` | a folder on a persistent disk for uploaded documents, e.g. `/var/lib/eduplatform/storage` (ADR-0023) |

## Checklist before the first deployment (Phase 7)

- HTTPS on every domain.
- Secrets from the hosting provider's secret manager, never `.env` files.
- Production database roles with strong passwords (not `infra/database/roles.sql`).
- `npm run db:migrate` runs in the deploy pipeline before the new API version starts.
- Change the seeded super admin's password immediately.
- `STORAGE_DIR` on a persistent disk (not inside the app's folder that a new release replaces), readable only by the API's user.
- **Back up the database and `STORAGE_DIR` together** (the database points to the files; one without the other is incomplete).
- A request size limit of at least 6 MB in front of the API and the web app (document uploads are up to 5 MB).
- Consider multi-factor login and password reset by email before real users arrive.

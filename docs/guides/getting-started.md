# Getting started (Windows, no Docker)

## 1. Install once

| Tool | Version | How |
|---|---|---|
| Node.js | 22 or newer (24 recommended) | https://nodejs.org |
| PostgreSQL | 18 | https://www.postgresql.org/download/windows/ — remember the `postgres` password |
| Git | any | https://git-scm.com |

Recommended VS Code extensions: ESLint, Prettier, Prisma.

## 2. Configure

```sh
copy .env.example .env
```

Open `.env` and put your PostgreSQL password in `DATABASE_ADMIN_URL`:

```
DATABASE_ADMIN_URL=postgres://postgres:<your password>@localhost:5432/postgres
```

This superuser connection is only used by `npm run db:setup` and the tests, to create the database and roles. The app itself connects with the limited role `edu_app`.

Also change `JWT_SECRET` to a long random text.

## 3. First run

```sh
npm install         # downloads libraries (one node_modules folder)
npm run db:setup    # creates roles edu_owner / edu_app and the database "eduplatform"
npm run db:migrate  # creates the tables
npm run db:seed     # module list + the first super admin (SEED_SUPER_ADMIN_* in .env)
npm run dev         # API on http://localhost:3000
```

## 4. Try it

1. Open http://localhost:3000/api/docs.
2. `POST /api/v1/auth/super-admin/login` → *Try it out* → your `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` → *Execute*. Copy `accessToken`. The first time, the seeded password must be changed before anything else (`POST /api/v1/auth/change-password`), or simply log in to the console at http://localhost:3003, which asks for it (ADR-0028).
3. Press **Authorize** (top right), paste the token.
4. `POST /api/v1/super-admin/organizations` creates an organization with its institutions and first admin.
5. `POST /api/v1/auth/login` with that admin's email and password gives an organization token. Press **Authorize** again and paste it. Try `GET /api/v1/dashboard` and `POST /api/v1/institutions/{id}/campuses`.

The token is kept when the page reloads. Super admin routes need the super admin's token; everything else needs an organization user's token.

**Postman**
1. *Import → Link →* `http://localhost:3000/api/docs-json` → *Import*. You get one collection with a folder per area (Login, Super admin, Organization, Students, …), and `{{baseUrl}}` is already `http://localhost:3000`.
2. Send *Login → POST /api/v1/auth/super-admin/login* (or */auth/login*) with an email and password in the body, and copy `accessToken` from the answer.
3. Open the collection → *Authorization* → type **Bearer Token** → paste the token (or put it in the collection variable `bearerToken`). Every request in the collection uses it.
4. After the API changes, import the link again to get the new routes.

## 5. Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the API, restarts on save |
| `npm run test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (temporary database, deleted afterwards) |
| `npm run lint`, `npm run typecheck`, `npm run format` | Checks and formatting |
| `npm run db:studio` | Browse the database in the browser |

Before you push: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_ADMIN_URL is missing` | Create `.env` from `.env.example` (step 2) |
| `password authentication failed for user "postgres"` | Wrong password in `DATABASE_ADMIN_URL` |
| `password authentication failed for user "edu_app"` | Run `npm run db:setup` |
| `The table ... does not exist` | Run `npm run db:migrate` |
| A list is always empty | The query isn't inside `prisma.forOrganization(...)`: row security hides everything. That's the safety net working |
| 403 "has no access rule" | The endpoint is missing an access decorator (`@RequirePermission(...)` etc.) |
| Port 3000 in use | Stop the other process, or set `PORT` in `.env` |

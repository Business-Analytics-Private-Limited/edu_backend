# Getting started (Windows, no Docker)

## 1. Install once

| Tool | Version | How |
|---|---|---|
| Node.js | 22 or newer (24 recommended) | https://nodejs.org |
| pnpm | 10 | `corepack enable` in an administrator terminal |
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

This superuser connection is only used by `pnpm db:setup` and the tests, to create the database and roles. The app itself connects with the limited role `edu_app`.

Also change `JWT_SECRET` to a long random text.

## 3. First run

```sh
pnpm install          # downloads libraries (one node_modules folder)
pnpm db:setup         # creates roles edu_owner / edu_app and the database "eduplatform"
pnpm db:migrate       # creates the tables
pnpm db:seed          # module list + the first super admin (SEED_SUPER_ADMIN_* in .env)
pnpm dev              # API on http://localhost:3000
```

## 4. Try it

1. Open http://localhost:3000/api/docs.
2. `POST /api/v1/auth/super-admin/login` → *Try it out* → your `SEED_SUPER_ADMIN_EMAIL` and `SEED_SUPER_ADMIN_PASSWORD` → *Execute*. Copy `accessToken`.
3. Press **Authorize** (top right), paste the token.
4. `POST /api/v1/super-admin/organizations` creates an organization and its first admin.
5. `POST /api/v1/auth/login` with that admin's email and password gives an organization token; with it, try `GET /api/v1/dashboard` and `POST /api/v1/institutions`.

Postman: *Import → Link →* `http://localhost:3000/api/docs-json`.

## 5. Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the API, restarts on save |
| `pnpm test` | Unit tests |
| `pnpm test:e2e` | End-to-end tests (temporary database, deleted afterwards) |
| `pnpm lint`, `pnpm typecheck`, `pnpm format` | Checks and formatting |
| `pnpm db:studio` | Browse the database in the browser |

Before you push: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.

## Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_ADMIN_URL is missing` | Create `.env` from `.env.example` (step 2) |
| `password authentication failed for user "postgres"` | Wrong password in `DATABASE_ADMIN_URL` |
| `password authentication failed for user "edu_app"` | Run `pnpm db:setup` |
| `The table ... does not exist` | Run `pnpm db:migrate` |
| A list is always empty | The query isn't inside `prisma.forOrganization(...)`: row security hides everything. That's the safety net working |
| 403 "has no access rule" | The endpoint is missing an access decorator (`@RequirePermission(...)` etc.) |
| Port 3000 in use | Stop the other process, or set `PORT` in `.env` |

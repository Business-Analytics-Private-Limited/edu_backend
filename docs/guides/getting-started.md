# Getting started (Windows, no Docker)

## 1. Install once

| Tool | Version | How |
|---|---|---|
| Node.js | 24 LTS | https://nodejs.org (the repository's `.nvmrc` says which) |
| pnpm | 10 | `corepack enable` in an administrator terminal (comes with Node.js) |
| PostgreSQL | 18 | https://www.postgresql.org/download/windows/ ; remember the `postgres` password you choose |
| Git | any | https://git-scm.com |

Recommended VS Code extensions: ESLint, Prettier, EditorConfig.

## 2. Configure

```sh
copy .env.example .env
```

Open `.env` and set your Postgres superuser password:

```
DATABASE_ADMIN_URL=postgres://postgres:<your password>@localhost:5432/postgres
```

This is used only to create roles and databases (`pnpm db:setup`, integration tests). The apps themselves connect with the project's limited roles.

## 3. First run

```sh
pnpm install          # downloads libraries
pnpm db:setup         # creates roles edu_owner, edu_app, … and the database "eduplatform"
pnpm keycloak:install # downloads Keycloak and a private Java 21 into .local/ (once, ~400 MB)
pnpm dev              # builds shared packages, runs migrations, starts Keycloak and every app
```

Open http://localhost:3000/api/docs for the API documentation (Swagger).

### Become the first platform owner (super admin)

1. Open http://localhost:8080, sign in with `admin` / `admin`, switch to the realm **platform**, and add a user under **Users** (email, first and last name; then **Credentials → Set password**, not temporary).
2. Link that account as platform owner:

   ```sh
   pnpm platform:add-staff -- --email you@example.com --role platform_owner
   ```

The super admin endpoints (`/api/v1/admin/...`) then accept that person's login.

## 4. Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs everything in watch mode; saves reload automatically |
| `pnpm dev:api` | Runs only the API; one service alone: [running-one-service.md](running-one-service.md) |
| `pnpm test` | Unit and architecture tests (fast, no database) |
| `pnpm test:integration` | Database tests on a throw-away database |
| `pnpm lint` | Code rules and boundary checks |
| `pnpm typecheck` | TypeScript errors |
| `pnpm format` | Formats all code |
| `pnpm db:migrate` | Applies new migrations |
| `pnpm contracts:build` | Rebuilds Swagger, types and the Postman collection after changing an OpenAPI file |

Before you push: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration`. CI runs the same checks.

## Troubleshooting

| Problem | Fix |
|---|---|
| `DATABASE_ADMIN_URL is not set` | Create `.env` from `.env.example` (step 2) |
| `password authentication failed for user "postgres"` | Wrong password in `DATABASE_ADMIN_URL` |
| `password authentication failed for user "edu_app"` | Run `pnpm db:setup` |
| `app.tenant_id is not set` | A query ran outside `withTenantTransaction()`; that is the safety net working |
| `... changed after it was applied` | You edited an applied migration. Undo the edit and write a new migration |
| Port 3000 in use | Stop the other process, or set `PORT` in `.env` |

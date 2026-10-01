# EduPlatform backend (working name)

A multi-tenant management platform for educational institutions: many organizations (school groups, college societies) use one system, and each sees only its own data.

This repository is the **backend API**. The web app and the super admin console are in the separate **eduplatform-frontend** repository.

## What it does today

| Area | Who | What |
|---|---|---|
| **Login** | Everyone | Super admins log in at `/auth/super-admin/login`, organization users at `/auth/login`. `/auth/me` says who you are and what you may do. |
| **Super admin area** | EduPlatform staff | Dashboard; create organizations (with their first admin); edit, suspend and activate them; switch modules on and off (Academic, Students, Attendance, Portal, Import). |
| **Predefined roles** | EduPlatform staff | Organization admin, Director, Principal, Campus admin, Senior / Junior faculty, DTP operator, Parent, Student. The super admin sets their permissions for all organizations at once. |
| **Organization area** | An organization's users | Dashboard; the organization's details; institutions and campuses; staff users; own roles (View / Create / Edit / Delete grid); audit log. |
| **Roles at places** | Built in | A user has one or more roles, each for the whole organization, one institution or one campus. A Campus admin sees and manages only their campus. Nobody can hand out more than they have. |
| **Multi-tenancy** | Built in | Every query is limited to the user's organization, and PostgreSQL row security blocks mistakes. |
| **Students** (module) | Organizations with the Students module | Admission at a campus (optionally with batch, section and parent in one go); profile; status with history; parents / guardians shared by siblings; one section per academic year with roll numbers; promotion to the next year (preview, adjust, apply) and moving students between sections; campus transfer; automatic admission numbers; import from CSV; undo of a promotion; documents (types, upload, verify / reject, download). |
| **Attendance** (module) | Organizations with the Attendance module | A section's register per day (present / absent / late / half day / leave); same-day changes; corrections of past days with reasons, kept as versions; only working days; correction window; time zone per institution; campus overview; section and student reports with percentages. |
| **Portal** (module) | Parents and students | Logins given by staff from a student's page; a parent's login covers all their children; they see details and attendance, and nothing of the staff side. |
| **Academic** (module) | Organizations with the Academic module | Academic years (one active per institution); class levels each institution names itself (e.g. Year → Group → Section, or Type → Group → Stream → Section); classes per campus as a tree; batches with a stage; subjects (attached to a class, inherited below); calendar with weekly off days and holidays. |

Coming next: period-wise and biometric attendance, phone login for the portal, preparing a pilot, then attendance, parent portal, data import (see `docs/06-roadmap.md`). Module by module: [docs/modules/README.md](docs/modules/README.md).

## Getting started

Prerequisites: Node.js 22+ (24 recommended), PostgreSQL 18 installed locally. npm comes with Node.js.

```sh
copy .env.example .env  # then put your Postgres password in DATABASE_ADMIN_URL
npm install
npm run db:setup        # creates the database and its two roles (once)
npm run db:migrate      # creates the tables
npm run db:seed         # adds the module list and the first super admin (from .env)
npm run dev             # starts the API on http://localhost:3000, restarts on save
```

- API documentation (try every endpoint): **http://localhost:3000/api/docs**
- Postman: *Import → Link →* `http://localhost:3000/api/docs-json`
- First login: `POST /api/v1/auth/super-admin/login` with `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` from `.env`.

## How a request flows

```
Browser / frontend
   │  GET /api/v1/institutions   (header: Authorization: Bearer <token>)
   ▼
RequestLoggerMiddleware      logs the request                        src/common/middleware
ThrottlerGuard               too many requests? → 429
JwtAuthGuard + JwtStrategy   valid token? who is it? → 401           src/common/guards, src/modules/auth
AccessGuard                  allowed by the endpoint's decorator? → 403
   ▼
Controller                   reads the request, calls the service    src/modules/organization/organization.controller.ts
Service                      the logic; talks to the database        src/modules/organization/organization.service.ts
PrismaService                runs the query for this organization    src/prisma/prisma.service.ts
   ▼
PostgreSQL                   row security: only this organization's rows
```

## Folders

```
src/
  main.ts                    starts the server
  app.module.ts              lists all modules and the guards
  setup-app.ts               /api/v1 prefix, security headers, CORS, validation, Swagger
  common/
    decorators/              @Public, @LoggedIn, @SuperAdminOnly, @OrganizationUser, @RequirePermission,
                             @CurrentUser, @OrganizationId
    guards/                  jwt-auth.guard.ts (logged in?), access.guard.ts (allowed?)
    middleware/              request logging
    filters/                 database errors → 404 / 409
    pagination.ts            ?page=&pageSize=
  prisma/                    the database connection (+ forOrganization / forAllOrganizations)
  modules/
    auth/                    login, me, change password
    super-admin/             dashboard, organizations, modules
    organization/            the tenant's dashboard, organization, institutions, campuses
    users/                   the tenant's staff users
    roles/                   roles, and permissions.ts (the list of every permission)
    audit/                   the audit log
    health/                  GET /health
prisma/
  schema.prisma              every table, with comments
  migrations/                how the database got to its current shape
  seed.ts                    module list + first super admin
test/                        end-to-end tests (real app, temporary database)
scripts/db-setup.mjs         creates roles and the database on your PostgreSQL
docs/                        product design and decisions
```

Each feature folder has the same four kinds of files: `*.controller.ts` (routes), `*.service.ts` (logic), `dto/` (what a request may contain) and `*.module.ts` (wiring).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Applies new migrations, then runs the API and restarts it on every save |
| `npm run test` | Unit tests (no database) |
| `npm run test:e2e` | End-to-end tests on a temporary database (deleted afterwards) |
| `npm run lint` / `npm run typecheck` / `npm run format` | Code checks and formatting |
| `npm run db:migration -- <name>` | Creates a migration after you edit `prisma/schema.prisma` |
| `npm run db:migrate` | Applies migrations |
| `npm run db:seed` | Adds the module list and the first super admin |
| `npm run db:studio` | Opens Prisma Studio, a browser view of the database |
| `npm run db:reset` | Deletes and recreates the development database (all data lost) |

## Documents

| Document | What it answers |
|---|---|
| [docs/guides/getting-started.md](docs/guides/getting-started.md) | Setup, first login, troubleshooting |
| [docs/guides/adding-a-feature.md](docs/guides/adding-a-feature.md) | How to add a new feature, step by step |
| [docs/01-product-requirements.md](docs/01-product-requirements.md) | Who uses it, what v1/v2/v3 contain |
| [docs/modules/README.md](docs/modules/README.md) | Every module: what is built, its endpoints and rules |
| [docs/04-roles-and-permissions.md](docs/04-roles-and-permissions.md) | Roles, places and permissions |
| [docs/06-roadmap.md](docs/06-roadmap.md) | Build phases |
| [docs/adr/](docs/adr/) | Decisions; ADR-0015 describes today's structure, ADR-0017 / 0018 the roles |

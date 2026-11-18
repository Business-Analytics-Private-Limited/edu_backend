# ADR-0024: Move to microservices, with tenants spread over several databases

Status: Proposed
Date: 2026-10-01

When accepted, this supersedes ADR-0015 (one NestJS app, one database) and ADR-0012 (no Docker). Everything else in ADR-0015 still applies inside each service: NestJS feature folders, Prisma, class-validator DTOs, Swagger from the code, Jest tests, and plain, readable code.

To avoid confusion with the product roadmap's phases (doc 6), the migration steps here are called **M0, M1, M2, …**

## Context

Today the backend is one NestJS app with one PostgreSQL database. Every organization's data is in that database, kept apart by `organization_id` and row-level security (ADR-0015).

The project owner wants the backend to become **microservices**, and **no single database should hold every organization's data**. EduPlatform is meant to serve many organizations. With one database:
- one heavy organization slows every other one;
- one database problem stops every organization;
- the database can only grow by buying a bigger server.

Two different problems are mixed here, and they need two different fixes:

| Problem | Fix |
|---|---|
| Every organization's data is in one database | **Tenant sharding:** organizations are spread over several databases (shards). A large organization can have its own. |
| One program does everything | **Microservices:** each feature runs as its own service with its own database, and services talk only through APIs and events. |

The plan does both, step by step. After each step the product works, the existing end-to-end tests pass, and there's no big-bang rewrite.

## Decision

### Where we end up

```
Browser ─► web (:3001) / admin (:3003)       (frontend: unchanged)
                │
                ▼
        API gateway (:3000)  ── checks the login, routes by URL, joins the Swagger docs
                │
   ┌──────────┬─┴─────────┬───────────┬────────────┬──────────┬─────────┐
   ▼          ▼           ▼           ▼            ▼          ▼         ▼
 Tenant    Identity   Academic    Students    Attendance   Files     Audit
 service   service    service     service     service      service   service
   │          │           │           │            │          │         │
 platform  directory +  shards     shards       shards     object    shards
 database  shards                                          storage
                    ▲           ▲            ▲                    ▲
                    └───────── message broker (events) ───────────┘
```

| Service | Owns | Comes from today's |
|---|---|---|
| **Tenant** | Organizations, modules on/off, super admins, predefined role templates, the **shard directory** (which database each organization lives on) | `super-admin`, part of `organization` |
| **Identity** | Users, passwords, password reset, staff roles and permissions, roles at places, portal logins | `auth`, `users`, `roles` |
| **Academic** | Institutions, campuses, academic years, class levels, classes, batches, subjects, calendar | rest of `organization`, `academic` |
| **Students** | Students, guardians, enrolments, promotion, transfer, import, admission numbers, documents (the records; the files go to Files) | `students` |
| **Attendance** | Attendance records, corrections, settings, reports; keeps its own copy of section lists | `attendance` |
| **Files** | Stored files, in object storage (S3 or MinIO) instead of a server folder | `files` |
| **Audit** | The audit log, filled from every service's events | `audit` |
| **Portal** | Nothing of its own; the parent and student views, reading from Students and Attendance | `portal` |

### Rules every service follows

1. **Its own database.** No service reads or writes another service's tables. To get another service's data, it calls that service's API or keeps a copy fed by events.
2. **Sharded by organization.** Every service that holds organization data uses the shard directory. Small organizations share a shard; a large one can have its own database. Row-level security stays inside every shard as a second safety net.
3. **Only the gateway is reachable from outside.** Services sit on an internal network. The gateway checks the login and passes the user's details to the service.
4. **Same structure in every service:** a standard NestJS app, laid out as in ADR-0015. A fresher who knows one service knows them all.
5. **One repository, NestJS monorepo mode.** Services live in `apps/<service>/` and shared code in `libs/` (the access decorators, shard lookup, logging). There's **one `package.json` and one `node_modules`**. This is the layout the NestJS documentation describes, and it avoids the "many packages, many node_modules" problem that ADR-0015 removed.
6. **`npm run dev` still starts everything.** It runs Docker Compose (databases, gateway, services, and later the broker). Docker Desktop becomes a requirement for developers.
7. **The API stays the same.** URLs, request and response shapes don't change, so the frontend and its types (ADR-0013) don't change. The existing end-to-end tests run against the gateway and must pass after every step.

### Migration steps

#### M0: Docker, gateway and logging (still one backend)
- Docker Compose for PostgreSQL and the current backend. A guide for interns.
- A small **API gateway** (a NestJS app) on port 3000:
  - It forwards to the backend, which moves to an internal port.
  - It also serves the joined Swagger docs at `/api/docs`.
- **Request ids** (`x-request-id`) on every request, plus structured (JSON) logs, so one request can be followed through every service later.
- Switch the backend to NestJS monorepo mode (`apps/core`, `apps/gateway`, `libs/common`).

**Done when:** the web and admin apps work unchanged through the gateway, and all end-to-end tests pass against the gateway.

#### M1: Tenant sharding (still one backend)
- A **platform database** holds what isn't organization data:
  - super admins and predefined role templates;
  - the organization list and module switches;
  - the **shard directory**: organization → shard;
  - the **login directory**: email → organization, needed because login happens before the organization is known.
- Two or more **shard databases** hold all organization data, with the same tables and row security as today.
- The backend picks the shard per request from the organization. The connection to each shard is kept open and reused.
- A shard's address comes from settings (`SHARD_<KEY>_URL`). The platform database stores only the key, never the password.
- **Placing organizations:**
  - A new organization goes on the shard with the fewest organizations, or on a shard the super admin chooses (e.g. its own database).
  - Moving an organization between shards is a manual, documented procedure for now.
- **Migrations:** `npm run db:migrate` runs on the platform database and on every shard.
- **Existing data:** a one-off script moves today's dev data onto shard 1.
- **Load-test checkpoint:** 50 fake organizations on 2 shards, with realistic attendance marking (k6). Every organization's response times must stay within the agreed limits, and one busy organization must not slow organizations on the other shard.

**Done when:** all end-to-end tests pass; the isolation tests cover organizations on different shards; the load test is reviewed with the owner.

#### M2: The first two services, Tenant and Identity
- **Tenant service:** the platform database from M1, moved out of the backend.
- **Identity service:** users, roles, permissions, roles at places, portal logins, and login itself.
  - It keeps the login directory and stores user data in the shards.
  - It signs login tokens; the gateway and the services check them.
- **Who is calling:** on every request, the gateway asks Identity for the user's grants and permissions, and asks Tenant for the organization's status and modules. It passes these to the service in an internal header.
  - Both answers are cached for at most **30 seconds**. So a deactivated user or suspended organization is blocked within 30 seconds, not instantly as today.
- **Places stay in the backend** (later the Academic service). Identity stores roles at places by id. When a role is given, Identity asks the backend whether the place exists. The services that check permissions already know their places' institution and campus.
- **Portal logins:**
  - Identity stores the linked student or guardian id as a plain id.
  - The Students part of the backend creates and removes portal logins through Identity's API.
  - Before showing a child, the backend checks that the child is linked.
- **Audit:** until the broker exists (M4), Tenant and Identity send audit entries to the backend's internal audit endpoint.
- **New in M2: password reset.**
  - "Forgot password" by email, with a single-use link valid for 30 minutes.
  - An admin can set a new temporary password for a user they manage.
  - In development, mail goes to Mailpit (a local mail viewer in Docker Compose).

**Done when:** all end-to-end tests pass through the gateway; login, deactivation, suspension and module switches work across services; the owner signs off.

#### After M2, in this order (each is its own step, planned in detail when it starts)
- **M3 Files:** its own service on MinIO / S3.
- **M4 Events:**
  - Add a message broker: RabbitMQ to start; Kafka only if volume ever needs it.
  - Events are written in the same transaction as the change, through an outbox table, and published from there (ADR-0006, revived).
  - Audit becomes a service that listens.
- **M5 Attendance:** its own service and shards; keeps its own copy of sections and students from Students' events, so marking works even if Students is down.
- **M6 Students and Academic:** the largest step. Promotion and campus transfer become steps with "undo" steps if one fails (sagas).
- **M7 Portal:** a thin service reading from Students and Attendance.

## Consequences

**What we gain:**
- No database holds every organization's data. Growth means adding shards, and a large customer can have its own database.
- Each service can be scaled, deployed and fixed on its own. A problem in one doesn't stop the others.
- Teams can own services separately later.

**What it costs:**
- **More things run:** with all steps done, about 8 services, a broker, several databases and object storage. Production needs containers. Kubernetes is decided later, when there are enough organizations to justify it.
- **Changes across features get harder.** One database transaction becomes several steps with events and undo steps, and a copy of data in another service can be seconds behind.
- **Debugging across services** needs the request ids and central logs from M0. Later it needs a log viewer (Grafana + Loki).
- **Feature work slows during M0–M2.** Password reset is built inside M2 because it belongs to Identity.
- **Developers need Docker Desktop.** The local setup guide and ADR-0012 change.
- **Blocking a user or organization is no longer instant.** It takes up to 30 seconds after deactivation or suspension (M2).

**Not decided here:**
- the hosting provider;
- Kubernetes;
- automatic moving of organizations between shards;
- the price of a dedicated database for large customers.

## Alternatives considered

- **Stay one backend with one database (ADR-0015).** Simplest, but rejected by the owner: every organization shares one database and one program.
- **Microservices without sharding.** Splits features, but every service's database still holds every organization, so the owner's main concern stays.
- **A database for every organization from the start.** The strongest isolation, but with hundreds of small schools that means hundreds of databases to migrate and back up. Shards that can hold one or many organizations give the same option to large customers without that cost.
- **A schema per organization in one database.** Still one database server for everyone, and migrations get slow with many schemas.
- **Rewrite as microservices in one go.** Months without a working product and no safety net. The step-by-step path keeps the product and its tests working after every step.
- **One repository per service, or a package per service.** More repositories, `node_modules` folders and version juggling. That was the complexity ADR-0015 removed. NestJS monorepo mode keeps one repository and one `node_modules`.

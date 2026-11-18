# ADR-0013: Separate repositories for backend and frontend

Status: Accepted
Date: 2026-09-29

Supersedes [ADR-0008](0008-repository-layout.md). Keeps the service layout of [ADR-0011](0011-microservice-ready-services.md), moved to the repository root.

## Context

The project owner wants a new backend developer to receive only backend code, and a new frontend developer only frontend code, with nothing shared between them. ADR-0008 had put both in one workspace so the frontend could import shared generated API types, which means every developer receives everything.

## Decision

- **Two Git repositories:**

  | Repository | Local folder | Contents |
  |---|---|---|
  | `eduplatform-backend` | `D:\eduplatform\eduplatform-backend` | `apps/` (api, worker, device-gateway), `services/`, `packages/` (server-kit, contracts, config), `infra/`, `docs/` (all design documents and ADRs) |
  | `eduplatform-frontend` | `D:\eduplatform\eduplatform-frontend` | `apps/` (web, admin), `packages/` (ui, api, config), its own `docs/` |

- **No shared code.** Each repository has its own dependencies, lockfile, lint and TypeScript settings, CI and README.
- **The API contract is the only link.** The backend owns it (`packages/contracts`, served at `/api/docs/openapi.json`). The frontend keeps a copy in `packages/api/openapi.json` and generates its TypeScript types from that copy with `pnpm api:sync`.
- **Design documents live in the backend repository.** The frontend repository has its own short docs, and reads the API through Swagger UI and the Postman collection.

## Consequences

- Access can be granted per repository.
- A backend API change no longer breaks the frontend build immediately. It appears when the frontend runs `pnpm api:sync`, and the type-checker then points at every affected screen. Backend changes to the contract must be announced (pull request note) until publishing the contract is automated (for example as a versioned package or a CI artifact).
- Tooling configuration (TypeScript, ESLint, Prettier) is duplicated in both repositories and may diverge over time; that is accepted as the price of independence.
- In the backend repository, paths lose their `backend/` prefix: `backend/services/audit` is now `services/audit`, and so on. ADR-0011's text still shows the old prefix.

## Alternatives considered

- **One repository, two independent folders:** simpler to set up, but every developer still receives both halves.
- **A third repository for the contract, published as a package:** automatic, but needs a package registry and a release step. Possible later.

# ADR-0004: pnpm + Turborepo monorepo with NestJS and Next.js

Status: Accepted
Date: 2026-09-28

## Context

Backend, frontends and shared contracts must evolve together, and one language across the stack keeps a two-person team efficient.

## Decision

- **Language:** TypeScript everywhere (strict mode).
- **Monorepo:** pnpm workspaces + Turborepo.
- **Backend:** NestJS for `apps/api`, `apps/worker`, `apps/device-gateway`. Its module system maps directly onto our business modules, and its dependency injection and guards suit `@RequireModule` / `@RequirePermission`.
- **Frontend:** Next.js (App Router) for `apps/web` (institutions, parents, students) and `apps/admin` (super admin), sharing `packages/ui` (Tailwind + shadcn/ui components) and generated API clients.
- **Contracts:** OpenAPI documents per module, and JSON Schema for event payloads, in `packages/contracts`. TypeScript types and clients are generated from them.
- **Validation:** zod at the edges (request bodies, settings schemas, event payloads).
- **Testing:** Vitest for unit tests; integration tests against real Postgres using Testcontainers; Playwright for end-to-end flows.
- **Local environment:** Docker Compose with Postgres, Redis, Keycloak, MinIO (S3-compatible) and Mailpit.
- **Jobs:** BullMQ on Redis for the worker.
- **Observability:** OpenTelemetry SDK; structured JSON logs (pino) with `tenant_id`, `user_id` and `request_id` on every line.

## Consequences

- Shared types between API and frontends catch contract breaks at build time.
- Everything runs in containers, so hosting (DigitalOcean or AWS) stays an open decision.
- The frontends are separate apps, so the super admin console can live on a separate domain with stricter access.

## Alternatives considered

- Java / Spring Boot or .NET: equally durable, but they would split the team across two languages. Rejected for now.
- Express without a framework: too little structure to keep module boundaries consistent over time. Rejected.

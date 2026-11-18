# ADR-0011: Microservice-ready backend: one package per service, one host process for now

Status: Accepted
Date: 2026-09-29

Builds on [ADR-0001](0001-modular-monolith.md) and refines the backend layout of [ADR-0008](0008-repository-layout.md).

## Context

The project owner wants a microservice architecture, and code that interns and future developers can read and change safely. ADR-0001 already requires modules that can be extracted into services, but kept them as folders inside one app, where a boundary is easy to cross by accident. Running every module as a separate deployed service today would multiply servers, deployments, network failures and debugging effort for a two-person team, and local development currently runs without Docker (ADR-0012).

## Decision

- Every business module is a **service package** in `backend/services/<name>/` (`@eduplatform/<name>-service`), built from the same template:

  ```
  backend/services/<name>/
    README.md          what the service does, its tables, endpoints and events
    package.json
    migrations/        0001_*.sql … : the service's tables, in its own schema
    src/
      index.ts         the ServiceDefinition, imported only by host apps
      manifest.ts      permissions, variants, settings, events, navigation
      <name>.module.ts NestJS wiring
      public/          the ONLY code other services may import
      http/            controllers (guards, validation)
      application/     use cases
      domain/          entities and business rules
      infrastructure/  repositories and SQL
      events/          published and consumed events
  ```

- A service may use another service only through `@eduplatform/<name>-service/public` (its client interface and types) or through events. A lint rule and an architecture test enforce this.
- **Host apps** run services. Today one host, `backend/apps/api`, runs every service listed in `src/services.ts` in one process, sharing one connection pool and one deployment.
- **Extracting a service** later means: a new host app that lists only that service; its public interface becomes an HTTP client; its schema moves to its own database. The service's code does not change.

## Consequences

- Boundaries are package boundaries, visible in the file tree and checked by tools, so a new developer can't cross them by accident.
- One process, one log stream and one debugger session while the team is small.
- Each service builds separately, so the build has a few more steps; Turborepo runs them in order.

## Alternatives considered

- **Full microservices now** (one deployed app per module, API gateway, message broker): the owner chose the microservice-ready option instead, to keep running and debugging simple until a service actually needs to scale on its own.
- **Modules as folders inside the API app** (the previous layout): boundaries depended on one test and were not visible as packages.

# ADR-0001: Modular monolith, extractable to services

Status: Accepted
Date: 2026-09-28

## Context

The product needs enterprise-grade separation between business domains (students, attendance, exams, fees …) and must stay maintainable for many years. The team is two developers. Running a dozen independently deployed microservices means many pipelines, network failures between services, distributed tracing and a message broker. That would consume most of the team's time before any product value ships.

## Decision

Build **one API application** (NestJS) made of strictly separated modules, plus two small deployables: `worker` (background jobs and event handling) and `device-gateway` (biometric ingestion, which has different traffic and security needs).

The boundaries are enforced as if modules were services:

- each module owns one Postgres schema, with no cross-schema queries or foreign keys;
- other modules may only import from a module's `public/` folder (enforced by a lint rule and an architecture test);
- cross-module reactions go through events and the outbox (ADR-0006);
- each module has its own manifest, migrations and tests.

## Consequences

- One deployment, one set of logs, simple local development. The whole system fits on one machine.
- **Extraction path:** a module that needs independent scaling or a separate team can move to its own service. Its public facade becomes an HTTP client, its schema moves to its own database, and its events already go through the outbox. No other module's code changes.
- The discipline must be kept. Once modules share tables, extraction is no longer possible, which is why these rules are enforced by tests rather than convention.

## Alternatives considered

- **Microservices from day one:** correct boundaries but unaffordable operations for two people. Rejected for now; this ADR keeps the option open.
- **Unstructured monolith:** fastest at first, but it becomes impossible to split. Rejected.

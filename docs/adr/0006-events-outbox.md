# ADR-0006: Domain events through a transactional outbox

Status: Accepted
Date: 2026-09-28

## Context

Modules must react to each other's changes without sharing tables. For example, attendance needs to know when a student is enrolled, and reporting needs everything. Events must never be lost or published for a change that was rolled back.

## Decision

- Each module has an `outbox` table in its schema. A write and its event are inserted in the **same transaction**.
- The `worker` relays outbox rows to BullMQ queues (one per consuming module) and marks them as sent.
- Event envelope follows **CloudEvents**: `id` (UUIDv7), `type` (`module.entity.verb`), `source`, `time`, `tenantid`, `subject`, `dataschema`, `data`.
- Payload schemas are versioned in `packages/contracts/events`. Breaking changes create a new `type` version (e.g. `students.student.admitted.v2`), and both versions are published during a transition period.
- Consumers are **idempotent**: they record processed event ids in their own `inbox` table.

## Consequences

- Reliable, ordered-per-entity event delivery without a separate broker.
- When a module is extracted or volume grows, the relay can publish to RabbitMQ, Kafka or NATS instead. Producers and consumers keep the same contracts.

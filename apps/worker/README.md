# Worker

`@eduplatform/worker`: work that happens outside an HTTP request.

| Path | What it is |
|---|---|
| `src/main.ts` | Starts the worker (no HTTP server) |
| `src/relay/relay.service.ts` | Outbox relay: every 500 ms, moves new events from each service's `outbox` table to one BullMQ queue per consuming service (ADR-0006) |
| `src/relay/routes.ts` | Which schemas have an outbox and which services consume which events. Empty until Phase 2 |
| `src/config.ts` | Settings |

Connects to the database as `edu_relay`, which can read and mark outbox rows and nothing else (ADR-0009).

Redis is only contacted when there is an event to deliver, so the worker runs without Redis while `routes.ts` is empty. Later phases add event consumers, imports and report jobs here.

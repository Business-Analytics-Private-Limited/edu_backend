/**
 * Which service schemas have an outbox, and which services consume which event types.
 * Kept in step with the manifests (`events.publishes` / `events.consumes`).
 *
 * Events with no consumer are simply marked as sent, so no queue (and no Redis) is needed
 * until a service consumes another service's events (ADR-0014).
 */
export const OUTBOX_SCHEMAS: string[] = ['platform'];

/** Event type → services that consume it. Nobody consumes events yet. */
export const EVENT_ROUTES: Record<string, string[]> = {};

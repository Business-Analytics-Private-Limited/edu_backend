/**
 * Which module schemas have an outbox, and which modules consume which event types.
 * Filled from module manifests (`events.publishes` / `events.consumes`) as modules are
 * added in Phase 2 onwards. Empty in Phase 1, so the relay has nothing to do yet.
 */
export const OUTBOX_SCHEMAS: string[] = [];

export const EVENT_ROUTES: Record<string, string[]> = {};

/**
 * Event envelope (ADR-0006). Follows CloudEvents 1.0; `tenantid` is an extension attribute.
 * Payload schemas live in `events/<type>.schema.json` and are versioned by `dataschema`.
 */
export interface CloudEvent<TData = unknown> {
  specversion: '1.0';
  /** UUIDv7; also the outbox row id. Consumers record it in their inbox for idempotency. */
  id: string;
  /** `module.entity.past_tense_verb`, e.g. `students.student.admitted`. */
  type: string;
  /** Producing module, e.g. `/modules/students`. */
  source: string;
  /** ISO 8601 instant in UTC. */
  time: string;
  tenantid: string;
  /** Id of the entity the event is about; events with the same subject are delivered in order. */
  subject: string;
  /** e.g. `students.student.admitted/1`. */
  dataschema: string;
  datacontenttype: 'application/json';
  data: TData;
}

export const EVENT_TYPE_PATTERN = /^[a-z_]+\.[a-z_]+\.[a-z_]+(\.v\d+)?$/;

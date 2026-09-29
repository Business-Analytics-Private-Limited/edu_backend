/**
 * Publishing events (ADR-0006).
 *
 * A service never sends an event directly. It inserts it into its own `outbox` table in the
 * SAME transaction as the change, so the event exists if and only if the change was saved.
 * The worker's relay (relay.ts) delivers it afterwards.
 */
import { EVENT_TYPE_PATTERN, type CloudEvent } from '@eduplatform/contracts';
import { requireTenantId } from '../context/request-context';
import { ident, type Tx } from '../db/transaction';
import { newId } from '../ids';

export interface DomainEvent<TData = unknown> {
  /** `module.entity.past_tense_verb`, e.g. `students.student.admitted`. */
  type: string;
  /** Id of the entity the event is about; ordering key for consumers. */
  subject: string;
  /** Payload schema id, e.g. `students.student.admitted/1`. */
  dataSchema: string;
  data: TData;
}

/**
 * Writes an event to the module's outbox inside the caller's transaction (ADR-0006,
 * CLAUDE.md rule 8). If the transaction rolls back, the event is never published.
 *
 * @param schema the publishing module's schema, e.g. `students`
 * @returns the event id
 */
export async function publishEvent<TData>(
  tx: Tx,
  schema: string,
  event: DomainEvent<TData>,
): Promise<string> {
  if (!EVENT_TYPE_PATTERN.test(event.type)) {
    throw new Error(`Event type must look like module.entity.past_tense_verb: ${event.type}`);
  }
  if (!event.type.startsWith(`${schema}.`)) {
    throw new Error(`Module "${schema}" can only publish its own events, not ${event.type}`);
  }
  const id = newId();
  await tx.client.query(
    `insert into ${ident(schema)}.outbox (id, tenant_id, type, subject, data_schema, data)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      requireTenantId(),
      event.type,
      event.subject,
      event.dataSchema,
      JSON.stringify(event.data),
    ],
  );
  return id;
}

export interface OutboxRow {
  id: string;
  tenant_id: string;
  type: string;
  subject: string;
  data_schema: string;
  data: unknown;
  occurred_at: Date;
}

export function toCloudEvent(schema: string, row: OutboxRow): CloudEvent {
  return {
    specversion: '1.0',
    id: row.id,
    type: row.type,
    source: `/modules/${schema}`,
    time: row.occurred_at.toISOString(),
    tenantid: row.tenant_id,
    subject: row.subject,
    dataschema: row.data_schema,
    datacontenttype: 'application/json',
    data: row.data,
  };
}

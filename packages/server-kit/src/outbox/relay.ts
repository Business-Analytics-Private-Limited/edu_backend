/**
 * The outbox relay: the second half of publishing events. Used by apps/worker.
 * See OutboxRelay below for how delivery and ordering work.
 */
import type { CloudEvent } from '@eduplatform/contracts';
import type { Pool } from 'pg';
import { ident, withTransaction } from '../db/transaction';
import { toCloudEvent, type OutboxRow } from './outbox';

export type EventSink = (event: CloudEvent) => Promise<void>;

export interface RelayOptions {
  batchSize?: number;
}

/**
 * Moves unsent outbox rows to the event sink (BullMQ in the worker) and marks them sent.
 * Connects as `edu_relay`, which may read and mark outbox rows of every tenant and nothing
 * else (ADR-0009).
 *
 * Delivery is at-least-once: if the commit fails after the sink accepted an event, the event
 * is sent again, so consumers are idempotent (they record event ids in their inbox).
 * On a sink failure the batch stops, so events of one module stay in order.
 */
export class OutboxRelay {
  private readonly batchSize: number;

  constructor(
    private readonly pool: Pool,
    private readonly schemas: readonly string[],
    private readonly sink: EventSink,
    options: RelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
  }

  /** Relays one batch per schema. Returns how many events were sent. */
  async relayOnce(): Promise<number> {
    let sent = 0;
    for (const schema of this.schemas) {
      sent += await this.relaySchema(schema);
    }
    return sent;
  }

  private relaySchema(schema: string): Promise<number> {
    const table = `${ident(schema)}.outbox`;
    return withTransaction(this.pool, async ({ client }) => {
      // skip locked: several relay instances can run without sending the same row twice.
      const { rows } = await client.query<OutboxRow>(
        `select id, tenant_id, type, subject, data_schema, data, occurred_at
           from ${table}
          where published_at is null
          order by id
          limit $1
          for update skip locked`,
        [this.batchSize],
      );
      let sent = 0;
      for (const row of rows) {
        try {
          await this.sink(toCloudEvent(schema, row));
        } catch (error) {
          await client.query(
            `update ${table} set attempts = attempts + 1, last_error = $2 where id = $1`,
            [row.id, String(error).slice(0, 2000)],
          );
          break;
        }
        await client.query(
          `update ${table} set published_at = now(), attempts = attempts + 1, last_error = null where id = $1`,
          [row.id],
        );
        sent++;
      }
      return sent;
    });
  }
}

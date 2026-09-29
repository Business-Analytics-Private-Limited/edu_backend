import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { CloudEvent } from '@eduplatform/contracts';
import { createLogger, createPool, OutboxRelay } from '@eduplatform/server-kit';
import { Queue } from 'bullmq';
import { loadConfig, redisConnection } from '../config';
import { EVENT_ROUTES, OUTBOX_SCHEMAS } from './routes';

/**
 * Moves events from every module's outbox to one BullMQ queue per consuming module
 * (ADR-0006). Runs as `edu_relay` (ADR-0009).
 */
@Injectable()
export class RelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly config = loadConfig();
  private readonly logger = createLogger('worker.relay', this.config.LOG_LEVEL);
  private readonly pool = createPool(this.config.DATABASE_RELAY_URL, { max: 2 });
  private readonly queues = new Map<string, Queue>();
  private readonly relay = new OutboxRelay(this.pool, OUTBOX_SCHEMAS, (event) =>
    this.dispatch(event),
  );
  private timer?: NodeJS.Timeout;
  private running = false;

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), this.config.RELAY_INTERVAL_MS);
    this.logger.info({ schemas: OUTBOX_SCHEMAS }, 'outbox relay started');
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.pool.end();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.relay.relayOnce();
      if (sent > 0) this.logger.debug({ sent }, 'events relayed');
    } catch (error) {
      this.logger.error({ err: error }, 'outbox relay failed');
    } finally {
      this.running = false;
    }
  }

  private async dispatch(event: CloudEvent): Promise<void> {
    for (const consumer of EVENT_ROUTES[event.type] ?? []) {
      // jobId = event id: BullMQ ignores a second add of the same event to the same queue.
      await this.queue(consumer).add(event.type, event, {
        jobId: event.id,
        attempts: 10,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: false,
      });
    }
  }

  private queue(consumer: string): Queue {
    let queue = this.queues.get(consumer);
    if (!queue) {
      queue = new Queue(`events.${consumer}`, {
        connection: redisConnection(this.config.REDIS_URL),
      });
      this.queues.set(consumer, queue);
    }
    return queue;
  }
}

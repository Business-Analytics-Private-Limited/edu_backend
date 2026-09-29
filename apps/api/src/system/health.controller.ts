/**
 * Health endpoints, used by hosting platforms to decide whether to send traffic here.
 *   GET /api/v1/health        "is the process running?"   (liveness)
 *   GET /api/v1/health/ready  "can it reach the database?" (readiness)
 *
 * Contract: packages/contracts/openapi/system.yaml
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { Public, ServiceUnavailableError } from '@eduplatform/server-kit';
import type { Pool } from 'pg';
import { APP_POOL } from '../db/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  @Get()
  @Public() // no login needed; health checks are the only public endpoints
  live(): { data: { status: 'ok' } } {
    return { data: { status: 'ok' } };
  }

  @Get('ready')
  @Public()
  async ready(): Promise<{ data: { status: 'ok'; checks: Record<string, 'ok'> } }> {
    try {
      await this.pool.query('select 1');
    } catch {
      // 503 tells the load balancer to stop sending traffic until the database is back.
      throw new ServiceUnavailableError('Database is not reachable');
    }
    return { data: { status: 'ok', checks: { database: 'ok' } } };
  }
}

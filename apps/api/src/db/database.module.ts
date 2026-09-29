/**
 * Opens the database connection pool and shares it with every service in this host.
 *
 * The pool connects as `edu_app`, a role that can never bypass Row-Level Security
 * (ADR-0009). Services receive it by injecting APP_POOL:
 *
 *   constructor(@Inject(APP_POOL) private readonly pool: Pool) {}
 *
 * and run tenant queries through withTenantTransaction() from @eduplatform/server-kit.
 */
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPool } from '@eduplatform/server-kit';
import type { Pool } from 'pg';
import { loadConfig } from '../config';

/** Injection token for the edu_app connection pool. */
export const APP_POOL = Symbol('APP_POOL');

@Global() // available to every module without importing DatabaseModule again
@Module({
  providers: [
    {
      provide: APP_POOL,
      useFactory: (): Pool => createPool(loadConfig().DATABASE_APP_URL),
    },
  ],
  exports: [APP_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  /** Closes connections cleanly when the app stops. */
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

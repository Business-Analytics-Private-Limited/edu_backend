/**
 * Opens the database connection pools and shares them with every service in this host.
 *
 *   APP_POOL       role edu_app: tenant work under Row-Level Security
 *   PLATFORM_POOL  role edu_platform: super admin work, schema "platform" only (ADR-0009)
 *
 * Services receive a pool by injecting its token (both tokens come from server-kit):
 *
 *   constructor(@Inject(APP_POOL) private readonly pool: Pool) {}
 */
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_POOL, createPool, PLATFORM_POOL } from '@eduplatform/server-kit';
import type { Pool } from 'pg';
import { loadConfig } from '../config';

@Global() // available to every module without importing DatabaseModule again
@Module({
  providers: [
    {
      provide: APP_POOL,
      useFactory: (): Pool => createPool(loadConfig().DATABASE_APP_URL),
    },
    {
      provide: PLATFORM_POOL,
      useFactory: (): Pool => createPool(loadConfig().DATABASE_PLATFORM_URL, { max: 4 }),
    },
  ],
  exports: [APP_POOL, PLATFORM_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(APP_POOL) private readonly appPool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  /** Closes connections cleanly when the app stops. */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.appPool.end(), this.platformPool.end()]);
  }
}

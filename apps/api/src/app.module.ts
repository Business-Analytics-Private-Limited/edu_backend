/**
 * Root NestJS module of the API host.
 *
 * The host itself contains almost no business code. AppModule.forRoot(services):
 *   1. opens the database connection (DatabaseModule),
 *   2. adds the health endpoints (SystemModule),
 *   3. loads the given services (all of them, or those in ENABLED_SERVICES; see services.ts),
 *   4. protects every endpoint with the global AccessGuard (deny by default).
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AccessGuard,
  AUTHORIZATION_PORT,
  DenyAllAuthorization,
  type ServiceDefinition,
} from '@eduplatform/server-kit';
import { DatabaseModule } from './db/database.module';
import { SystemModule } from './system/system.module';

@Module({})
export class AppModule {
  static forRoot(services: ServiceDefinition[]): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule, SystemModule, ...services.map((service) => service.module)],
      providers: [
        // Answers "is this module enabled?" and "does this user have this permission?".
        // Phase 2 replaces DenyAllAuthorization with the real platform and access services.
        // Until then only @Public() endpoints can be reached.
        { provide: AUTHORIZATION_PORT, useClass: DenyAllAuthorization },

        // Runs before every endpoint (CLAUDE.md rule 3).
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}

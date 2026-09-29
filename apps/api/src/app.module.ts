/**
 * Root NestJS module of the API host.
 *
 * The host itself contains almost no business code. AppModule.forRoot(services):
 *   1. opens the database connection (DatabaseModule),
 *   2. adds the health endpoints (SystemModule),
 *   3. loads the given services (all of them, or those in ENABLED_SERVICES; see services.ts),
 *   4. protects every endpoint with the global AccessGuard: login check, then module and
 *      permission checks, denying by default.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AccessGuard,
  AUTHENTICATOR,
  AUTHORIZATION_PORT,
  DenyAllAuthorization,
  IDENTITY_RESOLVER,
  KeycloakAuthenticator,
  KeycloakTokenVerifier,
  NoIdentityResolver,
  type IdentityResolver,
  type ServiceDefinition,
} from '@eduplatform/server-kit';
import { loadConfig } from './config';
import { DatabaseModule } from './db/database.module';
import { SystemModule } from './system/system.module';

@Module({})
export class AppModule {
  static forRoot(services: ServiceDefinition[]): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule, SystemModule, ...services.map((service) => service.module)],
      providers: [
        // Finds our own record (tenant user or platform staff) for a verified token.
        // Phase 2 replaces NoIdentityResolver with the identity and platform services;
        // until then every token is refused as "not an active account".
        { provide: IDENTITY_RESOLVER, useClass: NoIdentityResolver },

        // Checks the Keycloak token of every non-public request.
        {
          provide: AUTHENTICATOR,
          inject: [IDENTITY_RESOLVER],
          useFactory: (resolver: IdentityResolver) => {
            const config = loadConfig();
            const verifier = new KeycloakTokenVerifier({
              keycloakUrl: config.KEYCLOAK_URL,
              audience: config.API_AUDIENCE,
            });
            return new KeycloakAuthenticator(verifier, resolver);
          },
        },

        // Answers "is this module enabled?" and "does this user have this permission?".
        // Phase 2 replaces DenyAllAuthorization with the real platform and access services.
        { provide: AUTHORIZATION_PORT, useClass: DenyAllAuthorization },

        // Runs before every endpoint (CLAUDE.md rule 3).
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}

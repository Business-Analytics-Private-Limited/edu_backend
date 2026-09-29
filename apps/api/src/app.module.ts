/**
 * Root NestJS module of the API host.
 *
 * The host itself contains almost no business code. AppModule.forRoot(services):
 *   1. opens the database pools (DatabaseModule) and shares host-level values (HostModule),
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
  IDENTITY_RESOLVER,
  KeycloakAuthenticator,
  KeycloakTokenVerifier,
  TOKEN_VERIFIER,
  type IdentityResolver,
  type ServiceDefinition,
} from '@eduplatform/server-kit';
import { HostAuthorization } from './auth/host-authorization';
import { HostIdentityResolver } from './auth/host-identity-resolver';
import { loadConfig } from './config';
import { DatabaseModule } from './db/database.module';
import { HostModule } from './host.module';
import { SystemModule } from './system/system.module';

@Module({})
export class AppModule {
  static forRoot(services: ServiceDefinition[]): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule,
        HostModule,
        SystemModule,
        ...services.map((service) => service.module),
      ],
      providers: [
        // Finds our own record (platform staff now; tenant users with the identity service).
        { provide: IDENTITY_RESOLVER, useClass: HostIdentityResolver },

        // Checks the signature, realm, audience and expiry of Keycloak tokens.
        {
          provide: TOKEN_VERIFIER,
          useFactory: () => {
            const config = loadConfig();
            return new KeycloakTokenVerifier({
              keycloakUrl: config.KEYCLOAK_URL,
              audience: config.API_AUDIENCE,
            });
          },
        },

        // Token → our own active user, for every non-public request.
        {
          provide: AUTHENTICATOR,
          inject: [TOKEN_VERIFIER, IDENTITY_RESOLVER],
          useFactory: (verifier: KeycloakTokenVerifier, resolver: IdentityResolver) =>
            new KeycloakAuthenticator(verifier, resolver),
        },

        // Answers "is this module enabled?" and "does this user have this permission?".
        { provide: AUTHORIZATION_PORT, useClass: HostAuthorization },

        // Runs before every endpoint (CLAUDE.md rule 3).
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
    };
  }
}

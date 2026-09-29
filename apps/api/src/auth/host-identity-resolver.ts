/**
 * Who is behind a verified login token? The host asks the service that owns each kind of
 * account:
 *
 *   realm "platform" → platform service: an active platform staff member
 *   realm "tenants"  → identity service: an active user of one organization (Phase 2 step 3;
 *                      until then no tenant user can sign in)
 */
import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_FACADE, type PlatformFacade } from '@eduplatform/platform-service/public';
import type {
  AuthenticatedIdentity,
  IdentityResolver,
  VerifiedToken,
} from '@eduplatform/server-kit';

@Injectable()
export class HostIdentityResolver implements IdentityResolver {
  constructor(@Inject(PLATFORM_FACADE) private readonly platform: PlatformFacade) {}

  async resolve(token: VerifiedToken): Promise<AuthenticatedIdentity | null> {
    if (token.realm === 'platform') {
      const staff = await this.platform.findActiveStaff(token.subject);
      return staff ? { actorType: 'platform_user', userId: staff.id } : null;
    }
    // Tenant users: added with the identity service (Phase 2 step 3).
    return null;
  }
}

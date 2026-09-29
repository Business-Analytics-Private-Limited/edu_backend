/**
 * Answers the guard's two questions for the current request (doc 4 §4.1):
 *
 *                      "is the module enabled?"            "does the user have the permission?"
 *   platform staff     only the platform module             their platform role (platform service)
 *   tenant users       the tenant's entitlements            their roles (access service, Phase 2
 *                      (platform service, cached)           step 4; until then: no)
 */
import { Inject, Injectable } from '@nestjs/common';
import { PLATFORM_FACADE, type PlatformFacade } from '@eduplatform/platform-service/public';
import { requireContext, type AuthorizationPort } from '@eduplatform/server-kit';

@Injectable()
export class HostAuthorization implements AuthorizationPort {
  constructor(@Inject(PLATFORM_FACADE) private readonly platform: PlatformFacade) {}

  async isModuleEnabled(moduleKey: string): Promise<boolean> {
    const context = requireContext();
    if (context.actorType === 'platform_user') return moduleKey === 'platform';
    if (!context.tenantId) return false;
    return this.platform.isModuleEnabled(context.tenantId, moduleKey);
  }

  async hasPermission(permission: string): Promise<boolean> {
    const context = requireContext();
    if (context.actorType === 'platform_user' && context.userId) {
      return this.platform.staffHasPermission(context.userId, permission);
    }
    // Tenant users: roles and permissions arrive with the access service (Phase 2 step 4).
    return false;
  }
}

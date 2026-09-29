/**
 * What each platform staff role may do in the super admin console (docs/modules/platform.md,
 * "Platform staff" table). Platform staff never receive tenant permissions: to act inside an
 * organization they start an impersonation session.
 */
export type StaffRole = 'platform_owner' | 'platform_admin' | 'platform_support';

export const STAFF_PERMISSIONS: Record<StaffRole, ReadonlySet<string>> = {
  platform_owner: new Set([
    'admin.tenant.view',
    'admin.tenant.manage',
    'admin.entitlement.manage',
    'admin.plan.manage',
    'admin.flag.manage',
    'admin.impersonation.start',
    'admin.staff.manage',
  ]),
  platform_admin: new Set([
    'admin.tenant.view',
    'admin.tenant.manage',
    'admin.entitlement.manage',
    'admin.plan.manage',
    'admin.flag.manage',
  ]),
  platform_support: new Set(['admin.tenant.view', 'admin.impersonation.start']),
};

export function staffRoleAllows(role: StaffRole, permission: string): boolean {
  return STAFF_PERMISSIONS[role].has(permission);
}

/**
 * The platform's business rules, without a database.
 */
import { ProblemError } from '@eduplatform/server-kit';
import { describe, expect, it } from 'vitest';
import { checkDisable, checkEnable, type CatalogModule } from './entitlement-rules';
import { staffRoleAllows } from './staff-permissions';
import { nextStatus } from './tenant-rules';

const academic: CatalogModule = {
  key: 'academic',
  name: 'Academic',
  isCore: false,
  status: 'available',
  dependsOn: [],
  variants: [{ key: 'junior_college_v1', isDefault: true, status: 'available' }],
};
const attendance: CatalogModule = {
  key: 'attendance',
  name: 'Attendance',
  isCore: false,
  status: 'available',
  dependsOn: ['academic', 'students'],
  variants: [
    { key: 'manual', isDefault: true, status: 'available' },
    { key: 'biometric', isDefault: false, status: 'available' },
    { key: 'rfid', isDefault: false, status: 'planned' },
  ],
};
const audit: CatalogModule = {
  key: 'audit',
  name: 'Audit log',
  isCore: true,
  status: 'available',
  dependsOn: [],
  variants: [],
};

/** The error codes a rule throws, or 'ok'. */
function codes(run: () => unknown): string {
  try {
    run();
    return 'ok';
  } catch (error) {
    if (error instanceof ProblemError) return (error.errors ?? []).map((e) => e.code).join(',');
    throw error;
  }
}

describe('checkEnable', () => {
  it('grants the default variant when none is requested', () => {
    expect(checkEnable(academic, undefined, new Set())).toEqual(['junior_college_v1']);
  });

  it('needs every dependency to be enabled first', () => {
    expect(codes(() => checkEnable(attendance, [], new Set(['academic'])))).toBe(
      'missing_dependency',
    );
    expect(checkEnable(attendance, [], new Set(['academic', 'students']))).toEqual(['manual']);
  });

  it('accepts several available variants', () => {
    const enabled = new Set(['academic', 'students']);
    expect(checkEnable(attendance, ['manual', 'biometric'], enabled)).toEqual([
      'manual',
      'biometric',
    ]);
  });

  it('refuses unknown and planned variants', () => {
    const enabled = new Set(['academic', 'students']);
    expect(codes(() => checkEnable(attendance, ['rfid'], enabled))).toBe('variant_not_available');
    expect(codes(() => checkEnable(attendance, ['fingerprint'], enabled))).toBe('unknown_variant');
  });

  it('refuses unknown modules', () => {
    expect(codes(() => checkEnable(undefined, [], new Set()))).toBe('unknown_module');
  });
});

describe('checkDisable', () => {
  it('refuses core modules', () => {
    expect(codes(() => checkDisable(audit, []))).toBe('core_module');
  });

  it('refuses while an enabled module depends on it', () => {
    const enabled = [{ key: 'attendance', dependsOn: ['academic', 'students'] }];
    expect(codes(() => checkDisable(academic, enabled))).toBe('has_dependents');
    expect(codes(() => checkDisable(academic, []))).toBe('ok');
  });
});

describe('nextStatus', () => {
  it('activates an onboarding organization that has an institution', () => {
    expect(nextStatus('onboarding', 'activate', 1)).toBe('active');
    expect(codes(() => nextStatus('onboarding', 'activate', 0))).toBe('required');
  });

  it('suspends only active organizations and reactivates only suspended ones', () => {
    expect(nextStatus('active', 'suspend', 1)).toBe('suspended');
    expect(nextStatus('suspended', 'reactivate', 1)).toBe('active');
    expect(codes(() => nextStatus('onboarding', 'suspend', 1))).toBe('invalid_transition');
    expect(codes(() => nextStatus('active', 'reactivate', 1))).toBe('invalid_transition');
  });
});

describe('staff roles', () => {
  it('lets support staff look but not change', () => {
    expect(staffRoleAllows('platform_support', 'admin.tenant.view')).toBe(true);
    expect(staffRoleAllows('platform_support', 'admin.tenant.manage')).toBe(false);
    expect(staffRoleAllows('platform_admin', 'admin.entitlement.manage')).toBe(true);
    expect(staffRoleAllows('platform_admin', 'admin.staff.manage')).toBe(false);
  });
});

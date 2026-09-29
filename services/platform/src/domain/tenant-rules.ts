/**
 * Rules for an organization's life: onboarding → active ⇄ suspended (docs/modules/platform.md).
 */
import { ValidationError } from '@eduplatform/server-kit';

export type TenantStatus = 'onboarding' | 'active' | 'suspended' | 'closed';
export type StatusAction = 'activate' | 'suspend' | 'reactivate';

/** From which status each action is allowed, and where it leads. */
const TRANSITIONS: Record<StatusAction, { from: TenantStatus; to: TenantStatus }> = {
  activate: { from: 'onboarding', to: 'active' },
  suspend: { from: 'active', to: 'suspended' },
  reactivate: { from: 'suspended', to: 'active' },
};

/**
 * @param institutionCount activation needs at least one institution
 * @returns the new status
 */
export function nextStatus(
  current: TenantStatus,
  action: StatusAction,
  institutionCount: number,
): TenantStatus {
  const transition = TRANSITIONS[action];
  if (current !== transition.from) {
    throw new ValidationError(
      [
        {
          path: 'status',
          code: 'invalid_transition',
          message: `Can't ${action} an organization that is ${current}`,
        },
      ],
      `The organization is ${current}`,
    );
  }
  if (action === 'activate' && institutionCount === 0) {
    throw new ValidationError([
      {
        path: 'institutions',
        code: 'required',
        message: 'Add at least one institution before activating',
      },
    ]);
  }
  return transition.to;
}

/**
 * The academic structure template of each institution type (docs/03 §3.3). Only the junior
 * college template exists in v1; the others arrive in v3, but institutions can be created now.
 */
export const TEMPLATE_BY_TYPE = {
  junior_college: 'junior_college_v1',
  degree_college: 'degree_v1',
  engineering_college: 'engineering_v1',
  school: 'school_v1',
} as const;

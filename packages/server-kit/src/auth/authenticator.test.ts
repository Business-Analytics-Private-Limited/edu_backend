/**
 * From Authorization header to identity, with a fake verifier and resolver.
 */
import { describe, expect, it } from 'vitest';
import { ProblemError, UnauthenticatedError } from '../errors/problem';
import { KeycloakAuthenticator, type AuthenticatedIdentity } from './authenticator';
import type { KeycloakTokenVerifier, VerifiedToken } from './token-verifier';

const tenantsToken: VerifiedToken = {
  realm: 'tenants',
  subject: 'kc-1',
  organizations: ['sri-vidya'],
  claims: {},
};
const platformToken: VerifiedToken = { ...tenantsToken, realm: 'platform', organizations: [] };

const verifierReturning = (token: VerifiedToken) =>
  ({
    verify: async (raw: string) => {
      if (raw !== 'good-token') throw new UnauthenticatedError('The token is not valid');
      return token;
    },
  }) as unknown as KeycloakTokenVerifier;

const resolverReturning = (identity: AuthenticatedIdentity | null) => ({
  resolve: async () => identity,
});

const user: AuthenticatedIdentity = { actorType: 'user', userId: 'u-1', tenantId: 't-1' };
const staff: AuthenticatedIdentity = { actorType: 'platform_user', userId: 'p-1' };

async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ProblemError) return `${error.code}: ${error.detail}`;
    throw error;
  }
}

describe('KeycloakAuthenticator', () => {
  it('treats a request without a header as anonymous', async () => {
    const auth = new KeycloakAuthenticator(
      verifierReturning(tenantsToken),
      resolverReturning(user),
    );
    expect(await auth.authenticate(undefined)).toBeNull();
  });

  it('returns the identity for a good token of a known user', async () => {
    const auth = new KeycloakAuthenticator(
      verifierReturning(tenantsToken),
      resolverReturning(user),
    );
    expect(await auth.authenticate('Bearer good-token')).toEqual(user);
  });

  it('refuses headers that are not bearer tokens', async () => {
    const auth = new KeycloakAuthenticator(
      verifierReturning(tenantsToken),
      resolverReturning(user),
    );
    expect(await outcome(auth.authenticate('Basic abc'))).toMatch(/^unauthenticated/);
  });

  it('refuses a good token of a person we do not know (or who is deactivated)', async () => {
    const auth = new KeycloakAuthenticator(
      verifierReturning(tenantsToken),
      resolverReturning(null),
    );
    expect(await outcome(auth.authenticate('Bearer good-token'))).toBe(
      'unauthenticated: This account is not active in EduPlatform',
    );
  });

  it('never lets a tenants-realm token become platform staff, or the reverse', async () => {
    const tenantAsStaff = new KeycloakAuthenticator(
      verifierReturning(tenantsToken),
      resolverReturning(staff),
    );
    const staffAsTenant = new KeycloakAuthenticator(
      verifierReturning(platformToken),
      resolverReturning(user),
    );
    expect(await outcome(tenantAsStaff.authenticate('Bearer good-token'))).toMatch(/realm/);
    expect(await outcome(staffAsTenant.authenticate('Bearer good-token'))).toMatch(/realm/);
  });
});

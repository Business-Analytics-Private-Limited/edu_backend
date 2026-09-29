/**
 * Turns the Authorization header of a request into "who is this": a user of one tenant, or a
 * platform staff member (doc 3 §3.2, "Tenant resolution per request").
 *
 *   header ──► KeycloakTokenVerifier ──► VerifiedToken ──► IdentityResolver ──► AuthenticatedIdentity
 *               (is the token genuine?)                   (is this person one of OUR active users?)
 *
 * A genuine token is not enough: the person must also exist and be active in our own records
 * (identity.users for tenant users, platform.platform_users for staff). A deactivated user is
 * refused at once, even while their token is still valid.
 */
import { UnauthenticatedError } from '../errors/problem';
import type { KeycloakTokenVerifier, VerifiedToken } from './token-verifier';

/** The identity a request runs as, stored in the request context by the access guard. */
export interface AuthenticatedIdentity {
  actorType: 'user' | 'platform_user';
  /** identity.users.id (tenant users) or platform.platform_users.id (platform staff). */
  userId: string;
  /** The tenant a tenant user is acting in. Absent for platform staff. */
  tenantId?: string;
}

/**
 * Looks up our own record for a verified token. Returns null when the person is unknown or
 * not active. Implemented by the identity service (tenant users) and the platform service
 * (platform staff) from Phase 2.
 */
export interface IdentityResolver {
  resolve(token: VerifiedToken): Promise<AuthenticatedIdentity | null>;
}

export const IDENTITY_RESOLVER = Symbol('IDENTITY_RESOLVER');

/** Used until the identity and platform services exist: nobody is a known user yet. */
export class NoIdentityResolver implements IdentityResolver {
  async resolve(): Promise<null> {
    return null;
  }
}

/** Authenticates requests. The access guard calls it for every non-public endpoint. */
export interface Authenticator {
  /**
   * @returns the identity, or null when the request carries no token at all
   * @throws UnauthenticatedError when a token is present but not acceptable
   */
  authenticate(authorizationHeader: string | undefined): Promise<AuthenticatedIdentity | null>;
}

export const AUTHENTICATOR = Symbol('AUTHENTICATOR');

export class KeycloakAuthenticator implements Authenticator {
  constructor(
    private readonly verifier: KeycloakTokenVerifier,
    private readonly resolver: IdentityResolver,
  ) {}

  async authenticate(header: string | undefined): Promise<AuthenticatedIdentity | null> {
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1]) throw new UnauthenticatedError('Expected "Authorization: Bearer <token>"');

    const token = await this.verifier.verify(match[1]);
    const identity = await this.resolver.resolve(token);
    if (!identity) throw new UnauthenticatedError('This account is not active in EduPlatform');

    // Tokens from the platform realm can only become platform staff, and the other way round.
    const expected = token.realm === 'platform' ? 'platform_user' : 'user';
    if (identity.actorType !== expected) {
      throw new UnauthenticatedError('The account does not match the login realm');
    }
    return identity;
  }
}

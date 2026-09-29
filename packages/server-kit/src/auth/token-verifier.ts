/**
 * Checks Keycloak access tokens (ADR-0003).
 *
 * A browser or app logs in with Keycloak and receives an access token: a signed JSON Web
 * Token (JWT). Every API request carries it as `Authorization: Bearer <token>`. Before we
 * trust anything inside it, this class checks that:
 *   - Keycloak signed it (the signature matches Keycloak's published public keys),
 *   - it comes from one of our two realms (`tenants` or `platform`),
 *   - it was issued for this API (the `aud` claim contains our audience),
 *   - it hasn't expired.
 *
 * It says nothing about permissions: tokens carry identity only. Who may do what is decided
 * by the access service (docs/04-roles-and-permissions.md).
 */
import {
  createRemoteJWKSet,
  decodeJwt,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { UnauthenticatedError } from '../errors/problem';

/** Our Keycloak realms: `tenants` for everyone in an organization, `platform` for our staff. */
export type Realm = 'tenants' | 'platform';
export const REALMS: readonly Realm[] = ['tenants', 'platform'];

/** What we know after a token passed every check. */
export interface VerifiedToken {
  realm: Realm;
  /** Keycloak's id for the person (`sub`); identity.users.keycloak_sub links to it. */
  subject: string;
  /** Keycloak organization aliases the person belongs to (tenants realm only). */
  organizations: string[];
  /** Login session id (`sid`), for audit and logout. */
  sessionId?: string;
  /** All claims, for rare cases; prefer the fields above. */
  claims: JWTPayload;
}

export interface TokenVerifierOptions {
  /** Keycloak base URL, e.g. http://localhost:8080 */
  keycloakUrl: string;
  /** Audience our tokens must carry, e.g. `eduplatform-api` (set by a Keycloak mapper). */
  audience: string;
  /** Where to get a realm's signing keys. Default: Keycloak's JWKS endpoint. Tests pass local keys. */
  keysFor?: (realm: Realm) => JWTVerifyGetKey;
}

export class KeycloakTokenVerifier {
  private readonly keys = new Map<Realm, JWTVerifyGetKey>();

  constructor(private readonly options: TokenVerifierOptions) {}

  /** The issuer (`iss`) value Keycloak puts in tokens of a realm. */
  issuerOf(realm: Realm): string {
    return `${this.options.keycloakUrl.replace(/\/$/, '')}/realms/${realm}`;
  }

  /**
   * Checks a token and returns what it says.
   * @throws UnauthenticatedError for any problem; the reason goes in the detail, never the token.
   */
  async verify(token: string): Promise<VerifiedToken> {
    // Read the issuer WITHOUT trusting it yet, only to know which realm's keys to check with.
    let unverifiedIssuer: string | undefined;
    try {
      unverifiedIssuer = decodeJwt(token).iss;
    } catch {
      throw new UnauthenticatedError('The token is not a valid JWT');
    }
    const realm = REALMS.find((r) => this.issuerOf(r) === unverifiedIssuer);
    if (!realm) throw new UnauthenticatedError('The token was not issued by our login server');

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keysOf(realm), {
        issuer: this.issuerOf(realm),
        audience: this.options.audience,
        algorithms: ['RS256'], // Keycloak's default; never accept unsigned ("none") tokens
        clockTolerance: 30, // seconds of clock difference between servers
      }));
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) {
        throw new UnauthenticatedError('The token has expired');
      }
      throw new UnauthenticatedError('The token is not valid');
    }
    if (!payload.sub) throw new UnauthenticatedError('The token has no subject');

    return {
      realm,
      subject: payload.sub,
      organizations: readOrganizations(payload.organization),
      sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
      claims: payload,
    };
  }

  private keysOf(realm: Realm): JWTVerifyGetKey {
    let keys = this.keys.get(realm);
    if (!keys) {
      // Downloads Keycloak's public keys once and caches them; refetches when a new key
      // id appears (Keycloak rotating its keys).
      keys =
        this.options.keysFor?.(realm) ??
        createRemoteJWKSet(new URL(`${this.issuerOf(realm)}/protocol/openid-connect/certs`));
      this.keys.set(realm, keys);
    }
    return keys;
  }
}

/**
 * Keycloak's `organization` claim is a list of aliases (["sri-vidya"]), or an object keyed by
 * alias when organization ids are included ({"sri-vidya": {"id": "…"}}). Both become a list.
 */
function readOrganizations(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim.filter((v): v is string => typeof v === 'string');
  if (claim && typeof claim === 'object') return Object.keys(claim);
  return [];
}

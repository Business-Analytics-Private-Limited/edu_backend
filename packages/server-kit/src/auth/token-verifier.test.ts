/**
 * Token checks, with keys generated in the test instead of a running Keycloak.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProblemError } from '../errors/problem';
import { KeycloakTokenVerifier, type Realm } from './token-verifier';

const KEYCLOAK = 'http://keycloak.test';
const AUDIENCE = 'eduplatform-api';

/** A private signing key, as jose's generateKeyPair returns it. */
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let privateKey: PrivateKey;
let otherPrivateKey: PrivateKey;
let verifier: KeycloakTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey; // "not Keycloak's key"
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  verifier = new KeycloakTokenVerifier({
    keycloakUrl: KEYCLOAK,
    audience: AUDIENCE,
    keysFor: () => keys,
  });
});

interface TokenOptions {
  realm?: Realm | 'elsewhere';
  claims?: JWTPayload;
  audience?: string;
  expiresIn?: string;
  key?: PrivateKey;
}

function token(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ sid: 'session-1', ...options.claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('keycloak-user-1')
    .setIssuer(`${KEYCLOAK}/realms/${options.realm ?? 'tenants'}`)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.key ?? privateKey);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    if (error instanceof ProblemError) return `${error.code}: ${error.detail}`;
    throw error;
  }
}

describe('KeycloakTokenVerifier', () => {
  it('accepts a valid tenants-realm token and reads its identity', async () => {
    const result = await verifier.verify(await token({ claims: { organization: ['sri-vidya'] } }));
    expect(result).toMatchObject({
      realm: 'tenants',
      subject: 'keycloak-user-1',
      organizations: ['sri-vidya'],
      sessionId: 'session-1',
    });
  });

  it('knows platform-realm tokens', async () => {
    expect((await verifier.verify(await token({ realm: 'platform' }))).realm).toBe('platform');
  });

  it('reads organizations in both Keycloak formats', async () => {
    const withIds = await token({ claims: { organization: { 'sri-vidya': { id: 'x' } } } });
    expect((await verifier.verify(withIds)).organizations).toEqual(['sri-vidya']);
  });

  it('refuses an expired token', async () => {
    const expired = await token({ expiresIn: '-2m' });
    expect(await failure(verifier.verify(expired))).toBe('unauthenticated: The token has expired');
  });

  it('refuses a token signed with another key', async () => {
    const forged = await token({ key: otherPrivateKey });
    expect(await failure(verifier.verify(forged))).toBe('unauthenticated: The token is not valid');
  });

  it('refuses a token meant for another application', async () => {
    const otherAudience = await token({ audience: 'some-other-app' });
    expect(await failure(verifier.verify(otherAudience))).toBe(
      'unauthenticated: The token is not valid',
    );
  });

  it('refuses a token from another issuer', async () => {
    const foreign = await token({ realm: 'elsewhere' });
    expect(await failure(verifier.verify(foreign))).toBe(
      'unauthenticated: The token was not issued by our login server',
    );
  });

  it('refuses an unsigned token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        iss: `${KEYCLOAK}/realms/tenants`,
        aud: AUDIENCE,
        sub: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).toString('base64url');
    expect(await failure(verifier.verify(`${header}.${body}.`))).toBe(
      'unauthenticated: The token is not valid',
    );
  });

  it('refuses something that is not a JWT', async () => {
    expect(await failure(verifier.verify('not-a-token'))).toBe(
      'unauthenticated: The token is not a valid JWT',
    );
  });
});

/**
 * Login tokens for tests: signed with a key pair generated in the test, and a verifier that
 * trusts that key, so tests don't need a running Keycloak.
 *
 *   const tokens = await createTestTokens();
 *   moduleBuilder.overrideProvider(TOKEN_VERIFIER).useValue(tokens.verifier);
 *   request(...).set('Authorization', `Bearer ${await tokens.sign('platform', 'kc-owner')}`);
 */
import { KeycloakTokenVerifier, type Realm } from '@eduplatform/server-kit';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const KEYCLOAK = 'http://keycloak.test';
const AUDIENCE = 'eduplatform-api';

export interface TestTokens {
  verifier: KeycloakTokenVerifier;
  /** A valid access token for a Keycloak account (`subject`) in a realm. */
  sign(realm: Realm, subject: string, claims?: Record<string, unknown>): Promise<string>;
}

export async function createTestTokens(): Promise<TestTokens> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({
    keys: [{ ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' }],
  });
  return {
    verifier: new KeycloakTokenVerifier({
      keycloakUrl: KEYCLOAK,
      audience: AUDIENCE,
      keysFor: () => keys,
    }),
    sign: (realm, subject, claims = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setSubject(subject)
        .setIssuer(`${KEYCLOAK}/realms/${realm}`)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey),
  };
}

/**
 * "Continue with Google": the OpenID Connect authorization code flow with PKCE, state, and
 * nonce, via openid-client (a certified OpenID implementation). The only file that imports
 * it. Services receive a GoogleAuth; tests pass a fake, so they never call Google.
 *
 * Why each check:
 * - state: the callback must answer a sign-in this browser started (stops forged callbacks).
 * - PKCE: only the server that started the flow can swap the code for tokens.
 * - nonce: the ID token was minted for this sign-in, not replayed from another.
 * - ID token: openid-client validates issuer, audience, expiry, and nonce; we also turn on
 *   signature checking against Google's published keys (enableNonRepudiationChecks).
 */
import * as oidc from 'openid-client';

const GOOGLE_ISSUER = new URL('https://accounts.google.com');

/** One-time values kept in the visitor's session between the redirect and the callback. */
export interface GoogleChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface GoogleProfile {
  /** Google's permanent account ID. Users are matched on this, never on email. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export interface GoogleAuth {
  /** The Google URL to send the visitor to, and the checks to remember for the callback. */
  start(): Promise<{ url: string; checks: GoogleChecks }>;
  /** Exchanges the code in the callback URL and returns the verified identity. */
  finish(callbackUrl: URL, checks: GoogleChecks): Promise<GoogleProfile>;
}

export function createGoogleAuth({
  clientId,
  clientSecret,
  redirectUri,
}: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): GoogleAuth {
  // Discovery (Google's endpoints and keys) happens once, on first use, then is reused.
  // A failed attempt is forgotten so the next sign-in retries.
  let configuration: Promise<oidc.Configuration> | null = null;
  const getConfiguration = () => {
    configuration ??= oidc
      .discovery(GOOGLE_ISSUER, clientId, clientSecret, undefined, {
        execute: [oidc.enableNonRepudiationChecks],
      })
      .catch((err: unknown) => {
        configuration = null;
        throw err;
      });
    return configuration;
  };

  return {
    async start() {
      const config = await getConfiguration();
      const checks: GoogleChecks = {
        state: oidc.randomState(),
        nonce: oidc.randomNonce(),
        codeVerifier: oidc.randomPKCECodeVerifier(),
      };
      const url = oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        state: checks.state,
        nonce: checks.nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: 'S256',
        // Always let the visitor choose which Google account to use.
        prompt: 'select_account',
      });
      return { url: url.href, checks };
    },

    async finish(callbackUrl, checks) {
      const config = await getConfiguration();
      const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.codeVerifier,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims) throw new Error('Google returned no ID token');
      return {
        sub: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: claims.email_verified === true,
        name: typeof claims.name === 'string' ? claims.name : null,
      };
    },
  };
}

import { describe, it, expect, vi, beforeEach } from 'vitest';

// openid-client is replaced so these tests check what we ask Google for, without Google.
vi.mock('openid-client', () => ({
  discovery: vi.fn(async () => ({ fake: 'configuration' })),
  enableNonRepudiationChecks: vi.fn(),
  randomState: vi.fn(() => 'state-1'),
  randomNonce: vi.fn(() => 'nonce-1'),
  randomPKCECodeVerifier: vi.fn(() => 'verifier-1'),
  calculatePKCECodeChallenge: vi.fn(async () => 'challenge-1'),
  buildAuthorizationUrl: vi.fn(
    (_config, params: Record<string, string>) =>
      new URL(`https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(params)}`),
  ),
  authorizationCodeGrant: vi.fn(async () => ({
    claims: () => ({ sub: 'sub-1', email: 'ana@gmail.com', email_verified: true, name: 'Ana' }),
  })),
}));

const oidc = await import('openid-client');
const { createGoogleAuth } = await import('../googleOidc.ts');
const { createResendSender, createLogSender, createEmailSender, EmailDeliveryError } =
  await import('../email.ts');

const settings = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/api/v1/auth/google/callback',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createGoogleAuth', () => {
  it('asks only for openid, email, and profile, with state, nonce, PKCE (S256), and signature checks', async () => {
    const google = createGoogleAuth(settings);

    const { url, checks } = await google.start();

    expect(checks).toEqual({ state: 'state-1', nonce: 'nonce-1', codeVerifier: 'verifier-1' });
    const params = new URL(url).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      redirect_uri: settings.redirectUri,
      scope: 'openid email profile',
      state: 'state-1',
      nonce: 'nonce-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    expect(oidc.discovery).toHaveBeenCalledWith(
      new URL('https://accounts.google.com'),
      'client-id',
      'client-secret',
      undefined,
      { execute: [oidc.enableNonRepudiationChecks] },
    );
  });

  it('passes every check to the token exchange and returns the verified profile', async () => {
    const google = createGoogleAuth(settings);
    const checks = { state: 's', nonce: 'n', codeVerifier: 'v' };
    const callback = new URL('https://example.com/api/v1/auth/google/callback?code=c&state=s');

    const profile = await google.finish(callback, checks);

    expect(oidc.authorizationCodeGrant).toHaveBeenCalledWith(expect.anything(), callback, {
      expectedState: 's',
      expectedNonce: 'n',
      pkceCodeVerifier: 'v',
      idTokenExpected: true,
    });
    expect(profile).toEqual({
      sub: 'sub-1',
      email: 'ana@gmail.com',
      emailVerified: true,
      name: 'Ana',
    });
  });

  it('discovers Google once, and retries after a failed discovery', async () => {
    vi.mocked(oidc.discovery).mockRejectedValueOnce(new Error('network'));
    const google = createGoogleAuth(settings);

    await expect(google.start()).rejects.toThrow('network');
    await google.start();
    await google.start();

    expect(oidc.discovery).toHaveBeenCalledTimes(2);
  });

  it('treats a missing or non-boolean email_verified as unverified', async () => {
    vi.mocked(oidc.authorizationCodeGrant).mockResolvedValueOnce({
      claims: () => ({ sub: 'sub-2', email_verified: 'true' }),
    } as never);

    const profile = await createGoogleAuth(settings).finish(new URL(settings.redirectUri), {
      state: 's',
      nonce: 'n',
      codeVerifier: 'v',
    });

    expect(profile).toEqual({ sub: 'sub-2', email: null, emailVerified: false, name: null });
  });
});

describe('email senders', () => {
  const message = { to: 'ana@example.com', subject: 'Hi', text: 'Code 123456', html: '<p>Hi</p>' };

  it('sends through Resend with the API key and sender', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    const sender = createResendSender({
      apiKey: 're_key',
      from: 'M&I <hi@example.com>',
      fetchImpl,
    });

    await sender.send(message);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_key' });
    expect(JSON.parse(String(init.body))).toEqual({ from: 'M&I <hi@example.com>', ...message });
  });

  it('reports a rejected or unreachable send as EmailDeliveryError', async () => {
    const rejected = createResendSender({
      apiKey: 'k',
      from: 'f',
      fetchImpl: async () => new Response('domain not verified', { status: 403 }),
    });
    const unreachable = createResendSender({
      apiKey: 'k',
      from: 'f',
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
    });

    await expect(rejected.send(message)).rejects.toThrow(/403: domain not verified/);
    await expect(unreachable.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
  });

  it('logs instead of sending with the log transport', async () => {
    const log = { info: vi.fn() };

    await createLogSender(log as never).send(message);

    expect(log.info).toHaveBeenCalledWith(
      { to: message.to, subject: 'Hi', text: 'Code 123456' },
      expect.stringContaining('development only'),
    );
  });

  it('picks the sender from config', () => {
    expect(createEmailSender(null)).toBeNull();
    expect(createEmailSender({ transport: 'log' })).toHaveProperty('send');
    expect(createEmailSender({ transport: 'resend', apiKey: 'k', from: 'f' })).toHaveProperty(
      'send',
    );
  });
});

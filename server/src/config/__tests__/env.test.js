import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/dev',
  AUTH_SECRET: 'x'.repeat(32),
  CORS_ORIGINS: 'http://localhost:5173, https://example.com',
  DEPOSIT_PERCENT: '40', // test values only, not business values
  COMMISSION_REVISION_LIMIT: '3',
};

describe('loadConfig', () => {
  it('reads the business settings', () => {
    const config = loadConfig({ ...validEnv, DEPOSIT_PERCENT: '33.33' });

    expect(config.depositPercent).toBe(33.33);
    expect(config.commissionRevisionLimit).toBe(3);
  });

  it('refuses to start without the business settings (no invented defaults)', () => {
    const { DEPOSIT_PERCENT: _d, COMMISSION_REVISION_LIMIT: _r, ...withoutBusiness } = validEnv;

    expect(() => loadConfig(withoutBusiness)).toThrow(
      /DEPOSIT_PERCENT[\s\S]*COMMISSION_REVISION_LIMIT/,
    );
  });

  it.each(['101', '-1', '12.345'])('rejects DEPOSIT_PERCENT=%s', (value) => {
    expect(() => loadConfig({ ...validEnv, DEPOSIT_PERCENT: value })).toThrow(/DEPOSIT_PERCENT/);
  });

  it('parses a valid environment into a typed config', () => {
    const config = loadConfig(validEnv);

    expect(config).toMatchObject({
      nodeEnv: 'development',
      isProduction: false,
      port: 4000,
      logLevel: 'info',
      databaseUrl: validEnv.DATABASE_URL,
      corsOrigins: ['http://localhost:5173', 'https://example.com'],
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('applies the approved security defaults', () => {
    const config = loadConfig(validEnv);

    expect(config.trustProxy).toBe(0);
    expect(config.bcryptRounds).toBe(12);
    expect(config.sessionMaxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.rateLimits).toEqual({
      login: { limit: 10, windowMs: 15 * 60_000 },
      register: { limit: 5, windowMs: 60 * 60_000 },
    });
  });

  it('uses TEST_DATABASE_URL when NODE_ENV is test', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgres://u:p@localhost:5433/app_test',
    });

    expect(config.databaseUrl).toBe('postgres://u:p@localhost:5433/app_test');
  });

  it('requires TEST_DATABASE_URL in test mode, even if DATABASE_URL is set', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'test' })).toThrow(/TEST_DATABASE_URL/);
  });

  it('lists every invalid variable in one readable message', () => {
    let error;
    try {
      loadConfig({ NODE_ENV: 'development', AUTH_SECRET: 'short', CORS_ORIGINS: 'not-a-url' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toMatch(/AUTH_SECRET/);
    expect(error.message).toMatch(/CORS_ORIGINS/);
    expect(error.message).toMatch(/DATABASE_URL/);
  });

  it('treats empty strings as missing', () => {
    expect(() => loadConfig({ ...validEnv, AUTH_SECRET: '' })).toThrow(/AUTH_SECRET/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });
});

describe('loadConfig: Google sign-in and email', () => {
  const google = {
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    PUBLIC_URL: 'https://example.com/',
  };

  it('leaves Google off unless configured', () => {
    expect(loadConfig(validEnv).google).toBeNull();
  });

  it('builds the callback URL from PUBLIC_URL', () => {
    expect(loadConfig({ ...validEnv, ...google }).google).toEqual({
      clientId: 'id.apps.googleusercontent.com',
      clientSecret: 'secret',
      redirectUri: 'https://example.com/api/v1/auth/google/callback',
    });
  });

  it('refuses half a Google configuration, and Google without PUBLIC_URL', () => {
    expect(() => loadConfig({ ...validEnv, GOOGLE_CLIENT_ID: 'id' })).toThrow(
      /GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET[\s\S]*PUBLIC_URL/,
    );
  });

  it('prints codes to the log in development by default, and turns email off in production', () => {
    expect(loadConfig(validEnv).email).toEqual({ transport: 'log' });
    expect(loadConfig({ ...validEnv, NODE_ENV: 'production' }).email).toBeNull();
  });

  it("refuses the 'log' transport in production", () => {
    expect(() =>
      loadConfig({ ...validEnv, NODE_ENV: 'production', EMAIL_TRANSPORT: 'log' }),
    ).toThrow(/production logs[\s\S]*EMAIL_TRANSPORT/);
  });

  it('needs an API key, a sender, and the public URL (for links in emails) for Resend', () => {
    expect(() => loadConfig({ ...validEnv, EMAIL_TRANSPORT: 'resend' })).toThrow(
      /RESEND_API_KEY[\s\S]*EMAIL_FROM[\s\S]*PUBLIC_URL/,
    );
    expect(
      loadConfig({
        ...validEnv,
        EMAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_test',
        EMAIL_FROM: 'Marigold & Ink <hello@example.com>',
        PUBLIC_URL: 'https://example.com',
      }).email,
    ).toEqual({
      transport: 'resend',
      apiKey: 're_test',
      from: 'Marigold & Ink <hello@example.com>',
    });
  });
});

describe('loadConfig: Stripe payments', () => {
  const stripeEnv = {
    ...validEnv,
    PUBLIC_URL: 'https://example.com',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
    PAYMENT_CURRENCY: 'USD',
  };

  it('is off without keys', () => {
    expect(loadConfig(validEnv).stripe).toBeNull();
  });

  it('reads the keys and lowercases the currency', () => {
    expect(loadConfig(stripeEnv).stripe).toEqual({
      secretKey: 'sk_test_abc123',
      webhookSecret: 'whsec_abc123',
      currency: 'usd',
    });
  });

  it.each(['sk_live_abc123', 'rk_live_abc123', 'pk_test_abc123'])(
    'refuses %s (test-mode secret keys only)',
    (key) => {
      expect(() => loadConfig({ ...stripeEnv, STRIPE_SECRET_KEY: key })).toThrow(
        /test-mode key[\s\S]*STRIPE_SECRET_KEY/,
      );
    },
  );

  it('allows the currency alone (set in advance), but no partial Stripe setup', () => {
    expect(loadConfig({ ...validEnv, PAYMENT_CURRENCY: 'usd' }).stripe).toBeNull();
  });

  it('refuses part of the group, and payments without PUBLIC_URL', () => {
    const { PAYMENT_CURRENCY: _c, ...withoutCurrency } = stripeEnv;
    expect(() => loadConfig(withoutCurrency)).toThrow(
      /required for payments[\s\S]*PAYMENT_CURRENCY/,
    );
    const { STRIPE_WEBHOOK_SECRET: _w, ...withoutWebhook } = stripeEnv;
    expect(() => loadConfig(withoutWebhook)).toThrow(/STRIPE_WEBHOOK_SECRET/);

    const { PUBLIC_URL: _p, ...withoutUrl } = stripeEnv;
    expect(() => loadConfig(withoutUrl)).toThrow(/required for payments[\s\S]*PUBLIC_URL/);
  });

  it('rejects a malformed webhook secret or currency', () => {
    expect(() => loadConfig({ ...stripeEnv, STRIPE_WEBHOOK_SECRET: 'abc' })).toThrow(/whsec_/);
    expect(() => loadConfig({ ...stripeEnv, PAYMENT_CURRENCY: 'dollars' })).toThrow(/3-letter/);
  });
});

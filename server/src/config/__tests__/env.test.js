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
    expect(loadConfig(stripeEnv).paymentCurrency).toBe('usd');
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
    expect(loadConfig({ ...validEnv, PAYMENT_CURRENCY: 'usd' })).toMatchObject({
      stripe: null,
      paymentCurrency: 'usd',
    });
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

describe('loadConfig: giving (Digital Humani)', () => {
  const paymentsEnv = {
    ...validEnv,
    PUBLIC_URL: 'https://example.com',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
    PAYMENT_CURRENCY: 'usd',
  };
  const givingEnv = {
    ...paymentsEnv,
    DIGITALHUMANI_API_KEY: 'dh-key',
    DIGITALHUMANI_ENTERPRISE_ID: 'ent-1',
    DIGITALHUMANI_PROJECT_ID: 'proj-1',
    DIGITALHUMANI_ENVIRONMENT: 'sandbox',
    DONATION_PERCENT: '25', // a test value
  };

  it('is off without a Digital Humani key', () => {
    expect(loadConfig(paymentsEnv).giving).toBeNull();
  });

  it('reads every setting when switched on', () => {
    expect(loadConfig(givingEnv).giving).toEqual({
      apiKey: 'dh-key',
      enterpriseId: 'ent-1',
      projectId: 'proj-1',
      environment: 'sandbox',
      donationPercent: 25,
    });
  });

  it('requires every setting, including the donation percent, once any is set', () => {
    const { DONATION_PERCENT: _p, DIGITALHUMANI_PROJECT_ID: _id, ...missing } = givingEnv;
    expect(() => loadConfig(missing)).toThrow(/DIGITALHUMANI_PROJECT_ID[\s\S]*DONATION_PERCENT/);
  });

  it('needs payments switched on', () => {
    const { STRIPE_SECRET_KEY: _k, STRIPE_WEBHOOK_SECRET: _w, ...noPayments } = givingEnv;
    expect(() => loadConfig(noPayments)).toThrow(/giving needs payments[\s\S]*STRIPE_SECRET_KEY/);
  });

  it("refuses 'production' while payments are test-only (real trees, no real income)", () => {
    expect(() => loadConfig({ ...givingEnv, DIGITALHUMANI_ENVIRONMENT: 'production' })).toThrow(
      /production[\s\S]*DIGITALHUMANI_ENVIRONMENT/,
    );
  });

  it.each(['0', '-5', '101', '25.555', 'lots'])('rejects DONATION_PERCENT %s', (value) => {
    expect(() => loadConfig({ ...givingEnv, DONATION_PERCENT: value })).toThrow(/DONATION_PERCENT/);
  });
});

describe('loadConfig: files (Cloudflare R2)', () => {
  const filesEnv = {
    ...validEnv,
    R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    R2_ACCESS_KEY_ID: 'access-key',
    R2_SECRET_ACCESS_KEY: 'secret-key',
    R2_BUCKET: 'marigold-files',
  };

  it('is off without the R2 settings', () => {
    expect(loadConfig(validEnv).files).toBeNull();
  });

  it('reads every setting when switched on', () => {
    expect(loadConfig(filesEnv).files).toEqual({
      accountId: '0123456789abcdef0123456789abcdef',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      bucket: 'marigold-files',
    });
  });

  it('requires all four once any is set', () => {
    const { R2_SECRET_ACCESS_KEY: _s, R2_BUCKET: _b, ...missing } = filesEnv;
    expect(() => loadConfig(missing)).toThrow(/R2_SECRET_ACCESS_KEY[\s\S]*R2_BUCKET/);
  });

  it('rejects a malformed account ID or bucket name', () => {
    expect(() => loadConfig({ ...filesEnv, R2_ACCOUNT_ID: 'abc' })).toThrow(/R2_ACCOUNT_ID/);
    expect(() => loadConfig({ ...filesEnv, R2_BUCKET: 'Has_Capitals' })).toThrow(/R2_BUCKET/);
  });
});

describe('loadConfig: shipping (Shippo)', () => {
  const paymentsEnv = {
    ...validEnv,
    PUBLIC_URL: 'https://example.com',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
    PAYMENT_CURRENCY: 'usd',
  };
  const shippingEnv = {
    ...paymentsEnv,
    SHIPPO_API_KEY: 'shippo_test_abc123',
    PACKAGING_FEE_CENTS: '400', // a test value
    SHIP_FROM_NAME: 'Test Studio',
    SHIP_FROM_STREET1: '1 Test St',
    SHIP_FROM_CITY: 'Testville',
    SHIP_FROM_STATE: 'NY',
    SHIP_FROM_ZIP: '10001',
  };

  it('is off without the Shippo settings', () => {
    expect(loadConfig(paymentsEnv).shipping).toBeNull();
  });

  it('reads every setting when switched on, with an optional second street line', () => {
    expect(loadConfig(shippingEnv).shipping).toEqual({
      apiKey: 'shippo_test_abc123',
      packagingFeeCents: 400,
      from: {
        name: 'Test Studio',
        street1: '1 Test St',
        street2: null,
        city: 'Testville',
        state: 'NY',
        zip: '10001',
        email: null,
        phone: null,
      },
      webhookToken: null,
    });
    expect(loadConfig({ ...shippingEnv, SHIP_FROM_STREET2: 'Unit 2' }).shipping?.from.street2).toBe(
      'Unit 2',
    );
  });

  it("reads the sender's optional email and phone (needed for labels)", () => {
    const from = loadConfig({
      ...shippingEnv,
      SHIP_FROM_EMAIL: 'studio@example.com',
      SHIP_FROM_PHONE: '(212) 555-0100',
    }).shipping?.from;
    expect(from).toMatchObject({ email: 'studio@example.com', phone: '(212) 555-0100' });
    expect(() => loadConfig({ ...shippingEnv, SHIP_FROM_EMAIL: 'not-an-email' })).toThrow(
      /SHIP_FROM_EMAIL/,
    );
    expect(() => loadConfig({ ...shippingEnv, SHIP_FROM_PHONE: '555' })).toThrow(/SHIP_FROM_PHONE/);
    expect(() => loadConfig({ ...paymentsEnv, SHIP_FROM_PHONE: '212-555-0100' })).toThrow(
      /SHIPPO_API_KEY/,
    );
  });

  it('reads the optional tracking webhook secret, which must be long and link-safe', () => {
    const token = 'a'.repeat(32);
    expect(loadConfig({ ...shippingEnv, SHIPPO_WEBHOOK_TOKEN: token }).shipping?.webhookToken).toBe(
      token,
    );
    expect(() => loadConfig({ ...shippingEnv, SHIPPO_WEBHOOK_TOKEN: 'a'.repeat(31) })).toThrow(
      /SHIPPO_WEBHOOK_TOKEN/,
    );
    expect(() =>
      loadConfig({ ...shippingEnv, SHIPPO_WEBHOOK_TOKEN: `${'a'.repeat(32)}&x=1` }),
    ).toThrow(/SHIPPO_WEBHOOK_TOKEN/);
    // Alone, it switches shipping on, so the other settings are asked for.
    expect(() => loadConfig({ ...paymentsEnv, SHIPPO_WEBHOOK_TOKEN: token })).toThrow(
      /SHIPPO_API_KEY/,
    );
  });

  it('accepts a packaging fee of zero', () => {
    expect(
      loadConfig({ ...shippingEnv, PACKAGING_FEE_CENTS: '0' }).shipping?.packagingFeeCents,
    ).toBe(0);
  });

  it('requires the rest once any is set, the packaging fee included', () => {
    const { PACKAGING_FEE_CENTS: _f, SHIP_FROM_ZIP: _z, ...missing } = shippingEnv;
    expect(() => loadConfig(missing)).toThrow(/PACKAGING_FEE_CENTS[\s\S]*SHIP_FROM_ZIP/);
    expect(() => loadConfig({ ...paymentsEnv, SHIP_FROM_STREET2: 'Unit 2' })).toThrow(
      /SHIPPO_API_KEY/,
    );
  });

  it('needs payments switched on', () => {
    const {
      STRIPE_SECRET_KEY: _k,
      STRIPE_WEBHOOK_SECRET: _w,
      PAYMENT_CURRENCY: _c,
      ...noPayments
    } = shippingEnv;
    expect(() => loadConfig(noPayments)).toThrow(/shipping needs payments[\s\S]*STRIPE_SECRET_KEY/);
  });

  it('refuses a live token while payments are test-only', () => {
    expect(() => loadConfig({ ...shippingEnv, SHIPPO_API_KEY: 'shippo_live_abc' })).toThrow(
      /real postage[\s\S]*SHIPPO_API_KEY/,
    );
  });

  it.each([
    ['SHIPPO_API_KEY', 'not-a-token'],
    ['PACKAGING_FEE_CENTS', '-1'],
    ['PACKAGING_FEE_CENTS', '3.50'],
    ['SHIP_FROM_STATE', 'New York'],
    ['SHIP_FROM_ZIP', '1234'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadConfig({ ...shippingEnv, [key]: value })).toThrow(new RegExp(key));
  });
});

describe('loadConfig: SHOP_OPEN', () => {
  it('keeps the shop closed unless set to true', () => {
    expect(loadConfig(validEnv).shopOpen).toBe(false);
    expect(loadConfig({ ...validEnv, SHOP_OPEN: 'true' }).shopOpen).toBe(true);
    expect(() => loadConfig({ ...validEnv, SHOP_OPEN: 'yes' })).toThrow(/SHOP_OPEN/);
  });
});

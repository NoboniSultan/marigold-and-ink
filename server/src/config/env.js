import { z } from 'zod';

const commaSeparatedUrls = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1, 'must list at least one origin'));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url().optional(),
  TEST_DATABASE_URL: z.url().optional(),
  // Validated when present. It becomes required once something uses Redis (BullMQ, later).
  REDIS_URL: z.url().optional(),
  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  CORS_ORIGINS: commaSeparatedUrls,
  // Number of reverse proxies in front of the app (1 on Render). Needed so req.ip is
  // the real client IP (rate limiting) and req.secure is true behind HTTPS (cookies).
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // bcrypt work factor: each +1 doubles hashing time. Tests use the minimum (4) for speed.
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  // Failed logins allowed per IP + email per window, and registrations per IP per window.
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_REGISTER_WINDOW_MINUTES: z.coerce.number().int().min(1).default(60),
  // Business values set by the owner. Deliberately no defaults: the app refuses to
  // start rather than quietly charge a made-up deposit or allow a made-up revision count.
  DEPOSIT_PERCENT: z.coerce
    .number()
    .min(0)
    .max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: 'may have at most two decimal places',
    }),
  COMMISSION_REVISION_LIMIT: z.coerce.number().int().min(0).max(20),

  // The site's public address, e.g. https://marigold-and-ink-api.onrender.com. Google sends
  // visitors back to <PUBLIC_URL>/api/v1/auth/google/callback.
  PUBLIC_URL: z
    .url()
    .transform((url) => url.replace(/\/+$/, ''))
    .optional(),
  // "Continue with Google": both or neither (checked below). Secret: .env / Render only.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // How sign-up codes are sent: 'resend' (real email) or 'log' (printed to the server log,
  // development only). Defaults to 'log' outside production, and to off in production.
  EMAIL_TRANSPORT: z.enum(['resend', 'log']).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  // Sender, e.g. "Marigold & Ink <hello@yourdomain.com>"; the domain must be verified in Resend.
  EMAIL_FROM: z.string().min(3).optional(),

  // Stripe payments: the two secrets switch payments on, and then all three are required
  // (checked below). The currency alone may be set in advance. Secrets: .env / Render only.
  // Test mode only: a live key (sk_live_ / rk_live_) is refused, so this app can't take
  // real money by accident.
  STRIPE_SECRET_KEY: z
    .string()
    .regex(
      /^(sk|rk)_test_\w+$/,
      'must be a Stripe test-mode key (sk_test_…); live keys are refused',
    )
    .optional(),
  // Signs webhook deliveries: from `stripe listen` locally, or the Dashboard endpoint.
  STRIPE_WEBHOOK_SECRET: z
    .string()
    .regex(/^whsec_\w+$/, 'must start with whsec_')
    .optional(),
  // ISO 4217 code the shop charges in, set by the owner (no default).
  PAYMENT_CURRENCY: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.string().regex(/^[a-z]{3}$/, 'must be a 3-letter currency code, e.g. usd'))
    .optional(),

  // Giving (milestone 8): trees requested through Digital Humani when a commission is fully
  // paid. The API key switches it on, and then all of these are required (checked below).
  // Secrets: .env / Render only. See docs/setup-digital-humani.md.
  DIGITALHUMANI_API_KEY: z.string().min(1).optional(),
  DIGITALHUMANI_ENTERPRISE_ID: z.string().min(1).optional(),
  // Which planting project the trees go to (from Digital Humani's project list).
  DIGITALHUMANI_PROJECT_ID: z.string().min(1).optional(),
  // sandbox: free test requests, no real trees. production: real trees, invoiced to the owner.
  DIGITALHUMANI_ENVIRONMENT: z.enum(['sandbox', 'production']).optional(),
  // The share of each commission's full price that goes to trees. An owner-set business
  // value: no default.
  DONATION_PERCENT: z.coerce
    .number()
    .gt(0)
    .max(100)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: 'may have at most two decimal places',
    })
    .optional(),

  // Files (milestone 10): reference photos, watermarked previews, and final files, kept
  // in a private Cloudflare R2 bucket. All four switch it on together (checked below).
  // Secrets: .env / Render only. See docs/setup-r2.md.
  R2_ACCOUNT_ID: z
    .string()
    .regex(/^[0-9a-f]{32}$/, 'must be the 32-character account ID from the R2 dashboard')
    .optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  // Bucket names: 3–63 lowercase letters, digits, and hyphens.
  R2_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'must be an R2 bucket name')
    .optional(),

  // Shipping (milestone 11, ADR 0017): Shippo checks addresses and prices postage for
  // physical commissions. The key, the packaging fee, and the return address switch it on
  // together (checked below). Secrets and the address: .env / Render only, never the repo.
  // See docs/setup-shippo.md.
  SHIPPO_API_KEY: z
    .string()
    .regex(/^shippo_(test|live)_\w+$/, 'must be a Shippo API token (shippo_test_...)')
    .optional(),
  // Added to the postage on every shipment. An owner-set business value: no default.
  PACKAGING_FEE_CENTS: z.coerce.number().int().min(0).max(100_000).optional(),
  // The return address printed on labels.
  SHIP_FROM_NAME: z.string().min(1).max(100).optional(),
  SHIP_FROM_STREET1: z.string().min(1).max(100).optional(),
  SHIP_FROM_STREET2: z.string().min(1).max(100).optional(),
  SHIP_FROM_CITY: z.string().min(1).max(60).optional(),
  SHIP_FROM_STATE: z
    .string()
    .regex(/^[A-Z]{2}$/, 'must be a two-letter state code, e.g. NY')
    .optional(),
  SHIP_FROM_ZIP: z
    .string()
    .regex(/^[0-9]{5}(-[0-9]{4})?$/, 'must be a ZIP code, e.g. 10001')
    .optional(),
  // The sender's contact details, which USPS requires on every label (milestone 11b).
  // Optional so the site still starts without them; labels can't be bought until both are
  // set. Private: .env / Render only.
  SHIP_FROM_EMAIL: z.email().max(254).optional(),
  SHIP_FROM_PHONE: z
    .string()
    .regex(/^\+?[0-9 ().-]{10,20}$/, 'must be a phone number, e.g. 212-555-0100')
    .optional(),
  // The secret part of the tracking webhook's link (milestone 11b): Shippo calls
  // <PUBLIC_URL>/api/v1/webhooks/shippo?token=<this>. Optional: without it, tracking is
  // still checked once a day. Generate with: openssl rand -hex 32
  SHIPPO_WEBHOOK_TOKEN: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be 32 to 128 letters, digits, - or _')
    .optional(),
});

const STRIPE_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PAYMENT_CURRENCY'];
const FILES_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
// Optional: SHIP_FROM_STREET2, SHIP_FROM_EMAIL and SHIP_FROM_PHONE (needed for labels), and
// SHIPPO_WEBHOOK_TOKEN.
const SHIPPING_KEYS = [
  'SHIPPO_API_KEY',
  'PACKAGING_FEE_CENTS',
  'SHIP_FROM_NAME',
  'SHIP_FROM_STREET1',
  'SHIP_FROM_CITY',
  'SHIP_FROM_STATE',
  'SHIP_FROM_ZIP',
];
const GIVING_KEYS = [
  'DIGITALHUMANI_API_KEY',
  'DIGITALHUMANI_ENTERPRISE_ID',
  'DIGITALHUMANI_PROJECT_ID',
  'DIGITALHUMANI_ENVIRONMENT',
  'DONATION_PERCENT',
];

/**
 * Settings that only make sense together (Google sign-in, real email). Like the database
 * check, these run outside zod so every problem is reported at once.
 */
function groupProblems(env) {
  const problems = [];
  const nodeEnv = env.NODE_ENV ?? 'development';

  if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
    problems.push('✖ set both or neither\n  → at GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  }
  if (env.GOOGLE_CLIENT_ID && !env.PUBLIC_URL) {
    problems.push(
      '✖ is required for Google sign-in (Google redirects back to it)\n  → at PUBLIC_URL',
    );
  }

  const transport = emailTransport(env);
  if (transport === 'log' && nodeEnv === 'production') {
    problems.push(
      "✖ 'log' would put sign-up codes in production logs; use 'resend'\n  → at EMAIL_TRANSPORT",
    );
  }
  if (transport === 'resend') {
    // PUBLIC_URL too: real emails link back to the site, and a bare "/login" isn't a link.
    for (const key of ['RESEND_API_KEY', 'EMAIL_FROM', 'PUBLIC_URL']) {
      if (!env[key]) problems.push(`✖ is required when EMAIL_TRANSPORT=resend\n  → at ${key}`);
    }
  }

  const paymentsOn = Boolean(env.STRIPE_SECRET_KEY || env.STRIPE_WEBHOOK_SECRET);
  for (const key of STRIPE_KEYS) {
    if (paymentsOn && !env[key]) {
      problems.push(`✖ is required for payments (with the other Stripe settings)\n  → at ${key}`);
    }
  }
  if (paymentsOn && !env.PUBLIC_URL) {
    problems.push(
      '✖ is required for payments (Stripe sends the visitor back to it)\n  → at PUBLIC_URL',
    );
  }

  const givingOn = GIVING_KEYS.slice(0, 4).some((key) => env[key]);
  for (const key of GIVING_KEYS) {
    if (givingOn && !env[key]) {
      problems.push(
        `✖ is required for giving (with the other Digital Humani settings)\n  → at ${key}`,
      );
    }
  }
  if (givingOn && !paymentsOn) {
    problems.push(
      '✖ giving needs payments switched on (trees follow paid commissions)\n  → at STRIPE_SECRET_KEY',
    );
  }
  const filesOn = FILES_KEYS.some((key) => env[key]);
  for (const key of FILES_KEYS) {
    if (filesOn && !env[key]) {
      problems.push(`✖ is required for file uploads (with the other R2 settings)\n  → at ${key}`);
    }
  }
  const shippingOn = [
    ...SHIPPING_KEYS,
    'SHIP_FROM_STREET2',
    'SHIP_FROM_EMAIL',
    'SHIP_FROM_PHONE',
    'SHIPPO_WEBHOOK_TOKEN',
  ].some((key) => env[key] !== undefined);
  for (const key of SHIPPING_KEYS) {
    if (shippingOn && env[key] === undefined) {
      problems.push(`✖ is required for shipping (with the other shipping settings)\n  → at ${key}`);
    }
  }
  if (shippingOn && !paymentsOn) {
    problems.push(
      '✖ shipping needs payments switched on (postage is charged with the final payment)\n  → at STRIPE_SECRET_KEY',
    );
  }
  // Like trees: a live token buys real postage, paid by the owner, while payments are test-only.
  if (env.SHIPPO_API_KEY?.startsWith('shippo_live_')) {
    problems.push(
      "✖ a live token buys real postage while payments are test-only; use a 'shippo_test_' token\n  → at SHIPPO_API_KEY",
    );
  }
  // Stripe only ever takes test money (live keys are refused), so real trees would be paid
  // for by the owner with no real income behind them.
  if (env.DIGITALHUMANI_ENVIRONMENT === 'production') {
    problems.push(
      "✖ 'production' plants real trees, paid for by the owner, while payments are test-only; use 'sandbox'\n  → at DIGITALHUMANI_ENVIRONMENT",
    );
  }
  return problems.length ? problems.join('\n') : null;
}

function emailTransport(env) {
  if (env.EMAIL_TRANSPORT) return env.EMAIL_TRANSPORT;
  return (env.NODE_ENV ?? 'development') === 'production' ? undefined : 'log';
}

/**
 * Tests always use the separate test database; everything else uses DATABASE_URL.
 * Checked outside the zod schema on purpose: zod skips object-level refinements when a
 * field is missing entirely, which would hide this error behind the others. Checking it
 * separately keeps the promise of reporting every problem at once.
 */
function missingDatabaseVar(env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const requiredDbVar = nodeEnv === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  return env[requiredDbVar]
    ? null
    : `✖ is required when NODE_ENV=${nodeEnv}\n  → at ${requiredDbVar}`;
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validates raw environment variables and returns a typed, frozen config object.
 * Pure function: takes the env as an argument so it can be unit tested.
 */
export function loadConfig(rawEnv) {
  // Treat empty strings (e.g. `AUTH_SECRET=` in .env) as missing.
  const env = Object.fromEntries(Object.entries(rawEnv).filter(([, value]) => value !== ''));

  const result = envSchema.safeParse(env);
  const problems = [
    result.success ? null : z.prettifyError(result.error),
    missingDatabaseVar(env),
    groupProblems(env),
  ].filter(Boolean);

  if (problems.length > 0) {
    throw new ConfigError(
      `Invalid environment configuration:\n${problems.join('\n')}\n` +
        'Copy .env.example to .env and fill in the missing values.',
    );
  }

  const e = result.data;
  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.NODE_ENV === 'test' ? e.TEST_DATABASE_URL : e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    authSecret: e.AUTH_SECRET,
    corsOrigins: Object.freeze(e.CORS_ORIGINS),
    trustProxy: e.TRUST_PROXY,
    bcryptRounds: e.BCRYPT_ROUNDS,
    sessionMaxAgeMs: e.SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    rateLimits: Object.freeze({
      login: {
        limit: e.RATE_LIMIT_LOGIN_MAX,
        windowMs: e.RATE_LIMIT_LOGIN_WINDOW_MINUTES * 60_000,
      },
      register: {
        limit: e.RATE_LIMIT_REGISTER_MAX,
        windowMs: e.RATE_LIMIT_REGISTER_WINDOW_MINUTES * 60_000,
      },
    }),
    depositPercent: e.DEPOSIT_PERCENT,
    commissionRevisionLimit: e.COMMISSION_REVISION_LIMIT,
    publicUrl: e.PUBLIC_URL ?? null,
    // null = "Continue with Google" is off (the button is hidden).
    google: e.GOOGLE_CLIENT_ID
      ? Object.freeze({
          clientId: e.GOOGLE_CLIENT_ID,
          clientSecret: e.GOOGLE_CLIENT_SECRET,
          redirectUri: `${e.PUBLIC_URL}/api/v1/auth/google/callback`,
        })
      : null,
    // null = email sign-up is off (no way to send codes).
    email: (() => {
      const transport = emailTransport(e);
      if (transport === 'resend') {
        return Object.freeze({ transport, apiKey: e.RESEND_API_KEY, from: e.EMAIL_FROM });
      }
      return transport === 'log' ? Object.freeze({ transport }) : null;
    })(),
    // The shop's currency, known even before payments are switched on (to show prices).
    paymentCurrency: e.PAYMENT_CURRENCY ?? null,
    // null = payments are off (payment routes answer 503 PAYMENTS_UNAVAILABLE).
    stripe: e.STRIPE_SECRET_KEY
      ? Object.freeze({
          secretKey: e.STRIPE_SECRET_KEY,
          webhookSecret: e.STRIPE_WEBHOOK_SECRET,
          currency: e.PAYMENT_CURRENCY,
        })
      : null,
    // null = giving is off: no donations are recorded and no trees are requested.
    giving: e.DIGITALHUMANI_API_KEY
      ? Object.freeze({
          apiKey: e.DIGITALHUMANI_API_KEY,
          enterpriseId: e.DIGITALHUMANI_ENTERPRISE_ID,
          projectId: e.DIGITALHUMANI_PROJECT_ID,
          environment: e.DIGITALHUMANI_ENVIRONMENT,
          donationPercent: e.DONATION_PERCENT,
        })
      : null,
    // null = shipping is off: physical commissions can't take their final payment yet.
    shipping: e.SHIPPO_API_KEY
      ? Object.freeze({
          apiKey: e.SHIPPO_API_KEY,
          packagingFeeCents: e.PACKAGING_FEE_CENTS,
          from: Object.freeze({
            name: e.SHIP_FROM_NAME,
            street1: e.SHIP_FROM_STREET1,
            street2: e.SHIP_FROM_STREET2 ?? null,
            city: e.SHIP_FROM_CITY,
            state: e.SHIP_FROM_STATE,
            zip: e.SHIP_FROM_ZIP,
            email: e.SHIP_FROM_EMAIL ?? null,
            phone: e.SHIP_FROM_PHONE ?? null,
          }),
          webhookToken: e.SHIPPO_WEBHOOK_TOKEN ?? null,
        })
      : null,
    // null = file uploads are off: the file endpoints answer 503 FILES_UNAVAILABLE.
    files: e.R2_BUCKET
      ? Object.freeze({
          accountId: e.R2_ACCOUNT_ID,
          accessKeyId: e.R2_ACCESS_KEY_ID,
          secretAccessKey: e.R2_SECRET_ACCESS_KEY,
          bucket: e.R2_BUCKET,
        })
      : null,
  });
}

function loadConfigOrExit() {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Fail fast: print a readable message instead of a stack trace and refuse to boot.
    process.stderr.write(`\n${err.message}\n\n`);
    process.exit(1);
  }
}

export const config = loadConfigOrExit();

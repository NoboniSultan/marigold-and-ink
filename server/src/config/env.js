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
});

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

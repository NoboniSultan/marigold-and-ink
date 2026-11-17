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

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url().optional(),
    TEST_DATABASE_URL: z.url().optional(),
    // Validated when present. It becomes required once something uses Redis (BullMQ, later).
    REDIS_URL: z.url().optional(),
    AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    CORS_ORIGINS: commaSeparatedUrls,
  })
  .superRefine((env, ctx) => {
    // Tests always use the separate test database; everything else uses DATABASE_URL.
    const requiredDbVar = env.NODE_ENV === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
    if (!env[requiredDbVar]) {
      ctx.addIssue({
        code: 'custom',
        path: [requiredDbVar],
        message: `is required when NODE_ENV=${env.NODE_ENV}`,
      });
    }
  });

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
  if (!result.success) {
    throw new ConfigError(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}\n` +
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

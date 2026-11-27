import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Load ../.env for local runs. In CI there is no .env file and the workflow sets
// the variables directly. loadEnvFile never overwrites variables that are already set.
try {
  process.loadEnvFile('../.env');
} catch {
  // No .env file: rely on the environment.
}

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.{js,ts}',
      'scripts/**/__tests__/**/*.test.{js,ts}',
      'tests/**/*.test.{js,ts}',
    ],
    globalSetup: ['tests/setup/globalSetup.js'],
    setupFiles: ['tests/setup/setupFile.js'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // Fast hashing and generous limits so tests aren't slowed or throttled; the real
      // defaults are asserted in env.test.js and the limiter itself in rateLimit.test.js.
      BCRYPT_ROUNDS: '4',
      RATE_LIMIT_LOGIN_MAX: '1000',
      RATE_LIMIT_REGISTER_MAX: '1000',
      // Test-only business values (deliberately unlike any real price policy).
      DEPOSIT_PERCENT: '40',
      COMMISSION_REVISION_LIMIT: '2',
      // Payments switched on with dummy values. Payment tests pass a fake gateway
      // (tests/helpers/stripe.ts), so nothing ever reaches Stripe; the webhook secret matches
      // the one the helper signs with.
      PUBLIC_URL: 'https://marigold.test',
      STRIPE_SECRET_KEY: 'sk_test_never_used_in_tests',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_for_tests',
      PAYMENT_CURRENCY: 'usd',
      // Third-party services off, whatever a developer's .env holds: a real Digital Humani,
      // Resend, Google, or R2 key must never reach a test (blank counts as unset). Tests that
      // need one switch it on with a fake adapter passed to createApp.
      DIGITALHUMANI_API_KEY: '',
      DIGITALHUMANI_ENTERPRISE_ID: '',
      DIGITALHUMANI_PROJECT_ID: '',
      DIGITALHUMANI_ENVIRONMENT: '',
      DONATION_PERCENT: '',
      EMAIL_TRANSPORT: '',
      RESEND_API_KEY: '',
      EMAIL_FROM: '',
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
      R2_ACCOUNT_ID: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_BUCKET: '',
      SHIPPO_API_KEY: '',
      PACKAGING_FEE_CENTS: '',
      SHIP_FROM_NAME: '',
      SHIP_FROM_STREET1: '',
      SHIP_FROM_STREET2: '',
      SHIP_FROM_CITY: '',
      SHIP_FROM_STATE: '',
      SHIP_FROM_ZIP: '',
      SHIP_FROM_EMAIL: '',
      SHIP_FROM_PHONE: '',
      SHIPPO_WEBHOOK_TOKEN: '',
      // Small fixture content and images (tests/fixtures), so tests never depend on the
      // owner's real photos. content.real.test.ts validates the real files separately.
      CONTENT_DIR: path.join(import.meta.dirname, 'tests/fixtures/content'),
      MEDIA_DIR: path.join(import.meta.dirname, 'tests/fixtures/media'),
      CLIENT_DIST_DIR: path.join(import.meta.dirname, 'tests/fixtures/client-dist'),
    },
    // Integration tests share one test database and truncate it between tests,
    // so test files run one at a time to avoid wiping each other's data.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,ts}'],
      // CLI entry points: their logic lives in tested modules (app.js, migrator.js, seeds/).
      exclude: ['src/server.js', 'src/db/migrate.js', 'src/db/seed.js', 'src/**/__tests__/**'],
      reporter: ['text', 'html', 'lcov'],
      // `npm run test:coverage` (and therefore CI) fails if coverage drops below these.
      // Money-critical code must be fully covered (donations are added in milestone 8).
      thresholds: {
        lines: 90,
        branches: 85,
        'src/modules/commissions/commissions.stateMachine.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/modules/pricing/pricing.engine.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/lib/money.js': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'src/modules/orders/orders.{stateMachine,rules}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/modules/payments/payments.{service,webhooks,repository}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Giving: the tree arithmetic, the ledger, and the Digital Humani adapter (ADR 0013).
        'src/modules/giving/giving.{calculator,service,repository}.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/adapters/digitalHumani.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        // Two defensive branches (a non-Error thrown by the SDK) aren't worth faking.
        'src/adapters/stripe/stripeGateway.ts': {
          statements: 100,
          branches: 95,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});

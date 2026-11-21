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
      // Money-critical pure logic must be fully covered; payments and donations are
      // added in milestones 7 and 8.
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
      },
    },
  },
});

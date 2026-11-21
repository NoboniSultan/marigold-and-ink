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
    include: ['src/**/__tests__/**/*.test.js', 'tests/**/*.test.js'],
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
    },
    // Integration tests share one test database and truncate it between tests,
    // so test files run one at a time to avoid wiping each other's data.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      // CLI entry points: their logic lives in tested modules (app.js, migrator.js, seeds/).
      exclude: ['src/server.js', 'src/db/migrate.js', 'src/db/seed.js', 'src/**/__tests__/**'],
      reporter: ['text', 'html', 'lcov'],
      // Per-folder thresholds for the state machine, pricing, payments, and
      // donations modules are added in the milestones that create them.
    },
  },
});

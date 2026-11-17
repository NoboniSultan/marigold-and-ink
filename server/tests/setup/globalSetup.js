import pg from 'pg';

/**
 * Runs once before the whole test run, in the main Vitest process.
 * Refuses to run against anything that is not clearly a test database, and fails
 * with a helpful message if the test database is not running.
 */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. Copy .env.example to .env at the repo root.');
  }

  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against "${databaseName}": the test database name must end in "_test".`,
    );
  }

  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (err) {
    throw new Error(
      `Cannot reach the test database (${err.message}). Start it with: docker compose up -d db-test`,
      { cause: err },
    );
  } finally {
    await client.end().catch(() => {});
  }
}

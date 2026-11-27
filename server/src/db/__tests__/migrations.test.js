import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { readdirSync } from 'node:fs';
import { pool } from '../pool.js';
import { migrate, MIGRATIONS_DIR } from '../migrator.js';
import { config } from '../../config/env.js';
import { truncateAllTables } from '../../../tests/setup/database.js';

// Derived from the files on disk, so adding a migration never requires editing this test.
const MIGRATION_COUNT = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).length;

const EXPECTED_TABLES = [
  'artwork_tags',
  'artworks',
  'auth_identities',
  'charities',
  'commission_events',
  'commissions',
  'donations',
  'email_verifications',
  'files',
  'messages',
  'payments',
  'pgmigrations',
  'pricing_rules',
  'processed_webhook_events',
  'quotes',
  'sessions',
  'shipments',
  'shipping_labels',
  'tags',
  'tracking_events',
  'users',
];

/** Everything the migrations create in the public schema, so "down" can be checked for leftovers. */
async function schemaObjects() {
  const { rows } = await pool.query(`
    SELECT 'table' AS kind, tablename AS name FROM pg_tables WHERE schemaname = 'public'
    UNION ALL
    SELECT 'domain', t.typname FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'd'
    UNION ALL
    SELECT 'function', p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    UNION ALL
    SELECT 'extension', extname FROM pg_extension WHERE extname <> 'plpgsql'
    UNION ALL
    SELECT 'text_search_config', c.cfgname FROM pg_ts_config c
      JOIN pg_namespace n ON n.oid = c.cfgnamespace
      WHERE n.nspname = 'public'
    ORDER BY 1, 2
  `);
  return rows.map((r) => `${r.kind}:${r.name}`);
}

const run = (direction, count) => migrate({ databaseUrl: config.databaseUrl, direction, count });

// Whatever happens, leave the test database fully migrated for the other test files.
// These tests check the schema, not data. Other test files leave their last test's rows
// behind (tables are truncated before each test, not after), and some old down migrations
// can't run over rows they never expected, such as a deleted account with no password.
beforeAll(truncateAllTables);

afterAll(async () => {
  await run('up');
});

describe('migrations', () => {
  it('are fully applied by the global test setup', async () => {
    expect(await run('up')).toEqual([]); // nothing pending

    const tables = (await schemaObjects())
      .filter((o) => o.startsWith('table:'))
      .map((o) => o.slice(6));
    expect(tables).toEqual(EXPECTED_TABLES);
  });

  it('roll all the way down, leaving nothing behind but the migrations table', async () => {
    const reverted = await run('down', Infinity);

    expect(reverted).toHaveLength(MIGRATION_COUNT);
    expect(await schemaObjects()).toEqual(['table:pgmigrations']);
  });

  it('apply again cleanly after a full rollback', async () => {
    const applied = await run('up');

    expect(applied).toHaveLength(MIGRATION_COUNT);
    expect(await schemaObjects()).toEqual(
      expect.arrayContaining([
        'domain:commission_status',
        'domain:fulfillment_type',
        'extension:citext',
        'function:reject_modification',
        'function:set_updated_at',
      ]),
    );
  });

  it('can each be reverted and re-applied one step at a time', async () => {
    for (let i = 0; i < MIGRATION_COUNT; i += 1) {
      expect(await run('down', 1)).toHaveLength(1);
    }
    expect(await schemaObjects()).toEqual(['table:pgmigrations']);

    for (let i = 0; i < MIGRATION_COUNT; i += 1) {
      expect(await run('up', 1)).toHaveLength(1);
    }
    expect(await run('up')).toEqual([]);
  });
});

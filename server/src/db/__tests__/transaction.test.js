import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { pool } from '../pool.js';
import { withTransaction } from '../transaction.js';

// A scratch table for these tests only; real tables arrive with migrations in milestone 2.
const TABLE = 'tx_helper_test';

beforeAll(async () => {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id serial PRIMARY KEY, label text NOT NULL)`,
  );
  await pool.query(`TRUNCATE ${TABLE}`);
});

afterAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
});

async function countRows() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${TABLE}`);
  return rows[0].n;
}

describe('withTransaction', () => {
  it('commits all writes and returns the callback result', async () => {
    const result = await withTransaction(async (client) => {
      await client.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, ['first']);
      await client.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, ['second']);
      return 'done';
    });

    expect(result).toBe('done');
    expect(await countRows()).toBe(2);
  });

  it('rolls back every write when the callback throws, and rethrows the error', async () => {
    const before = await countRows();

    await expect(
      withTransaction(async (client) => {
        await client.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, ['should vanish']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(await countRows()).toBe(before);
  });

  it('rolls back when a later query in the transaction fails', async () => {
    const before = await countRows();

    await expect(
      withTransaction(async (client) => {
        await client.query(`INSERT INTO ${TABLE} (label) VALUES ($1)`, ['should vanish']);
        await client.query(`INSERT INTO ${TABLE} (label) VALUES (NULL)`); // violates NOT NULL
      }),
    ).rejects.toThrow(/null value/);

    expect(await countRows()).toBe(before);
  });

  it('returns the client to the pool after success and after failure', async () => {
    await withTransaction(async () => {});
    await withTransaction(async () => {
      throw new Error('fail');
    }).catch(() => {});

    expect(pool.totalCount).toBe(pool.idleCount); // nothing left checked out
  });

  it('destroys the client instead of reusing it if ROLLBACK itself fails', async () => {
    const rollbackError = new Error('connection lost');
    const client = {
      query: vi.fn(async (sql) => {
        if (sql === 'ROLLBACK') throw rollbackError;
      }),
      release: vi.fn(),
    };
    const fakeDb = { connect: async () => client };

    await expect(
      withTransaction(
        async () => {
          throw new Error('original');
        },
        { db: fakeDb },
      ),
    ).rejects.toThrow('original');

    expect(client.release).toHaveBeenCalledWith(rollbackError);
  });
});

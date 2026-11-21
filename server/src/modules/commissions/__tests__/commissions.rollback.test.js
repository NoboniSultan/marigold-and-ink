import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createQuotedCommission } from '../../../../tests/factories/index.js';

// Make only the event insert fail, keeping every other repository function real.
// (vi.mock is hoisted above the imports below, so the service sees the mocked module.)
vi.mock('../commissions.repository.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    insertEvent: vi.fn(async () => {
      throw new Error('simulated failure writing the event row');
    }),
  };
});

const { applyTransition } = await import('../commissions.service.js');

beforeEach(truncateAllTables);

describe('applyTransition atomicity', () => {
  it('rolls back the status change when writing the event fails', async () => {
    const commission = await createQuotedCommission({ status: 'deposit_paid' });

    await expect(
      applyTransition({
        commissionId: commission.id,
        toStatus: 'in_progress',
        actor: { type: 'admin', userId: commission.client_id },
      }),
    ).rejects.toThrow('simulated failure writing the event row');

    // The UPDATE ran before the failing INSERT, but the transaction rolled it back.
    const { rows } = await pool.query('SELECT status FROM commissions WHERE id = $1', [
      commission.id,
    ]);
    expect(rows[0].status).toBe('deposit_paid');
    expect(pool.totalCount).toBe(pool.idleCount); // the client went back to the pool
  });
});

/**
 * In production, a shipping email whose wording is still a placeholder is never sent. Only
 * `nodeEnv` is changed here: the database stays the test one (its URL was read at load).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createQuotedCommission, createUser } from '../../../../tests/factories/index.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';

vi.mock('../../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/env.js')>();
  return { ...actual, config: { ...actual.config, nodeEnv: 'production' } };
});

const { notifyStatusChange } = await import('../shipping.tracking.service.ts');

beforeEach(truncateAllTables);

describe('shipping emails in production', () => {
  it('are held back while the wording is a placeholder', async () => {
    const client = await createUser();
    const commission = await createQuotedCommission({
      clientId: client.id,
      status: 'shipped',
      fulfillmentType: 'physical',
    });
    const email = fakeEmail();

    await notifyStatusChange(
      {
        id: commission.id,
        status: 'shipped',
        clientId: client.id,
        fulfillmentType: 'physical',
      },
      email.sender,
    );

    expect(email.sent).toEqual([]);
  });
});

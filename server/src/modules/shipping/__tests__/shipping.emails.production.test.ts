/**
 * In production, the shipping emails go out with the owner's wording, and one whose wording
 * is a placeholder (should it ever be put back) is held back. Only `nodeEnv` is changed here:
 * the database stays the test one (its URL was read at load).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createQuotedCommission, createUser } from '../../../../tests/factories/index.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';

const wording = vi.hoisted(() => ({ placeholder: false }));

vi.mock('../../../config/env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../config/env.js')>();
  return { ...actual, config: { ...actual.config, nodeEnv: 'production' } };
});

// Lets one test put a placeholder back into the "shipped" email.
vi.mock('../shipping.emails.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shipping.emails.ts')>();
  return {
    ...actual,
    shippedEmail: (...args: Parameters<typeof actual.shippedEmail>) => {
      const message = actual.shippedEmail(...args);
      return wording.placeholder ? { ...message, subject: 'PLACEHOLDER: subject' } : message;
    },
  };
});

const { notifyStatusChange } = await import('../shipping.tracking.service.ts');

beforeEach(async () => {
  await truncateAllTables();
  wording.placeholder = false;
});

async function notifyShipped() {
  const client = await createUser();
  const commission = await createQuotedCommission({
    clientId: client.id,
    status: 'shipped',
    fulfillmentType: 'physical',
  });
  const email = fakeEmail();
  await notifyStatusChange(
    { id: commission.id, status: 'shipped', clientId: client.id, fulfillmentType: 'physical' },
    email.sender,
  );
  return email.sent;
}

describe('shipping emails in production', () => {
  it("are sent with the owner's wording", async () => {
    const sent = await notifyShipped();
    expect(sent.map((m) => m.subject)).toEqual(['Your Marigold & Ink order is on its way!']);
  });

  it('are held back if the wording is a placeholder', async () => {
    wording.placeholder = true;
    expect(await notifyShipped()).toEqual([]);
  });
});

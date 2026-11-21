import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createPricingRule, createCommission } from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';

const app = createApp();

// Test prices (cents). DEPOSIT_PERCENT is 40 in the test environment.
async function seedTestPrices() {
  await createPricingRule({ ruleType: 'base', size: 'M', medium: 'ink', amountCents: 10_000 });
  await createPricingRule({
    ruleType: 'extra_subject',
    size: null,
    medium: null,
    amountCents: 3_000,
  });
  await createPricingRule({ ruleType: 'rush', size: null, medium: null, amountCents: 2_501 });
  for (const [fulfillmentType, amountCents] of [
    ['digital', 0],
    ['physical', 1_500],
    ['mixed_media', 2_000],
  ]) {
    await createPricingRule({
      ruleType: 'fulfillment',
      size: null,
      medium: null,
      fulfillmentType,
      amountCents,
    });
  }
}

beforeEach(async () => {
  await truncateAllTables();
  await seedTestPrices();
});

const quoteUrl = (id) => `/api/v1/commissions/${id}/quote`;
const generate = (agent, id) => agent.post(quoteUrl(id)).set('Origin', TRUSTED_ORIGIN);
const adjust = (agent, id, body) =>
  agent.patch(quoteUrl(id)).set('Origin', TRUSTED_ORIGIN).send(body);
const send = (agent, id) => agent.post(`${quoteUrl(id)}/send`).set('Origin', TRUSTED_ORIGIN);

function inquiry(overrides = {}) {
  return createCommission({
    size: 'M',
    medium: 'ink',
    subjectCount: 2,
    fulfillmentType: 'physical',
    isRush: true,
    ...overrides,
  });
}

describe('POST /commissions/:id/quote (generate)', () => {
  it('computes an itemized draft from the active pricing rules', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();

    const res = await generate(agent, commission.id);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'draft',
      computedAmountCents: 10_000 + 3_000 + 1_500 + 2_501,
      adjustedAmountCents: null,
      totalCents: 17_001,
      depositCents: 6_800, // 40% of 17,001 = 6,800.4, rounded half up
      balanceCents: 10_201,
      sentAt: null,
    });
    expect(res.body.data.lineItems.map((i) => [i.code, i.amountCents])).toEqual([
      ['base', 10_000],
      ['extra_subject', 3_000],
      ['fulfillment', 1_500],
      ['rush', 2_501],
    ]);
  });

  it('replaces an earlier draft, keeping it as superseded history', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();

    await generate(agent, commission.id);
    await generate(agent, commission.id);

    const { rows } = await pool.query(
      'SELECT status FROM quotes WHERE commission_id = $1 ORDER BY id',
      [commission.id],
    );
    expect(rows.map((r) => r.status)).toEqual(['superseded', 'draft']);
  });

  it('returns 422 PRICING_RULE_MISSING when the request uses an unpriced combination', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry({ medium: 'charcoal' });

    const res = await generate(agent, commission.id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRICING_RULE_MISSING');
  });

  it('returns 409 QUOTE_NOT_ALLOWED once the commission is past inquiry', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);
    await send(agent, commission.id);

    const res = await generate(agent, commission.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTE_NOT_ALLOWED');
  });

  it('is admin only (403 for a client, 401 without a session)', async () => {
    const { agent, user } = await loggedInAgent(app);
    const commission = await inquiry({ clientId: user.id });

    expect((await generate(agent, commission.id)).status).toBe(403);
    expect((await generate(request(app), commission.id)).status).toBe(401);
  });

  it('returns 404 for a missing commission and 400 for a bad id', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    expect((await generate(agent, 999999)).body.error.code).toBe('COMMISSION_NOT_FOUND');
    expect((await generate(agent, 'abc')).status).toBe(400);
  });
});

describe('PATCH /commissions/:id/quote (admin adjustment)', () => {
  it('overrides the price with a note, keeping the computed amount', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);

    const res = await adjust(agent, commission.id, {
      adjustedAmountCents: 15_000,
      adjustmentNote: 'Returning client discount',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      computedAmountCents: 17_001,
      adjustedAmountCents: 15_000,
      adjustmentNote: 'Returning client discount',
      totalCents: 15_000,
      depositCents: 6_000,
      balanceCents: 9_000,
    });
  });

  it.each([
    ['without a note', { adjustedAmountCents: 15_000 }, 'adjustmentNote'],
    ['with a blank note', { adjustedAmountCents: 15_000, adjustmentNote: '   ' }, 'adjustmentNote'],
    [
      'with fractional cents',
      { adjustedAmountCents: 150.5, adjustmentNote: 'x' },
      'adjustedAmountCents',
    ],
    [
      'with a negative amount',
      { adjustedAmountCents: -1, adjustmentNote: 'x' },
      'adjustedAmountCents',
    ],
  ])('rejects an adjustment %s (400)', async (_label, body, field) => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);

    const res = await adjust(agent, commission.id, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path)).toContain(field);
  });

  it('returns 404 QUOTE_NOT_FOUND with no draft, and 409 QUOTE_NOT_EDITABLE after sending', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    const body = { adjustedAmountCents: 100, adjustmentNote: 'x' };

    expect((await adjust(agent, commission.id, body)).body.error.code).toBe('QUOTE_NOT_FOUND');

    await generate(agent, commission.id);
    await send(agent, commission.id);
    const res = await adjust(agent, commission.id, body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTE_NOT_EDITABLE');
  });

  it('is admin only', async () => {
    const { agent, user } = await loggedInAgent(app);
    const commission = await inquiry({ clientId: user.id });

    const res = await adjust(agent, commission.id, {
      adjustedAmountCents: 1,
      adjustmentNote: 'cheap',
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /commissions/:id/quote/send', () => {
  it('sends the quote: commission becomes quoted with total, deposit and balance, plus an event', async () => {
    const { agent, user: admin } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    const { body: draft } = await generate(agent, commission.id);

    const res = await send(agent, commission.id);

    expect(res.status).toBe(200);
    expect(res.body.data.commission).toMatchObject({
      status: 'quoted',
      quotedTotalCents: 17_001,
      depositCents: 6_800,
      balanceCents: 10_201,
    });
    expect(res.body.data.quote).toMatchObject({
      id: draft.data.id,
      status: 'sent',
      sentAt: expect.any(String),
    });

    const { rows } = await pool.query(
      `SELECT * FROM commission_events WHERE commission_id = $1 AND to_status = 'quoted'`,
      [commission.id],
    );
    expect(rows[0]).toMatchObject({
      from_status: 'inquiry',
      actor_type: 'admin',
      actor_user_id: admin.id,
      reason: 'Quote sent',
      metadata: { quoteId: draft.data.id, totalCents: 17_001, depositPercent: 40 },
    });
  });

  it('uses the adjusted amount when there is one', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);
    await adjust(agent, commission.id, {
      adjustedAmountCents: 12_345,
      adjustmentNote: 'Simplified background',
    });

    const res = await send(agent, commission.id);

    expect(res.body.data.commission).toMatchObject({
      quotedTotalCents: 12_345,
      depositCents: 4_938, // 40% of 12,345 = 4,938.0
      balanceCents: 7_407,
    });
  });

  it('returns 404 QUOTE_NOT_FOUND when there is no draft to send', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();

    const res = await send(agent, commission.id);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('QUOTE_NOT_FOUND');
  });

  it('cannot send twice', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);
    await send(agent, commission.id);

    const res = await send(agent, commission.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTE_NOT_EDITABLE');
  });

  it('rolls everything back if the commission was canceled meanwhile', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);
    await pool.query(`UPDATE commissions SET status = 'canceled' WHERE id = $1`, [commission.id]);

    const res = await send(agent, commission.id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMMISSION_INVALID_TRANSITION');
    const { rows } = await pool.query(
      'SELECT status, sent_at FROM quotes WHERE commission_id = $1',
      [commission.id],
    );
    expect(rows[0]).toEqual({ status: 'draft', sent_at: null }); // markSent was rolled back
  });

  it('is admin only', async () => {
    const { agent, user } = await loggedInAgent(app);
    const commission = await inquiry({ clientId: user.id });

    expect((await send(agent, commission.id)).status).toBe(403);
  });
});

describe('GET /commissions/:id/quote', () => {
  it('hides a draft from the client but shows it once sent', async () => {
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });
    const { agent: client, user } = await loggedInAgent(app);
    const commission = await inquiry({ clientId: user.id });
    await generate(admin, commission.id);

    const beforeSend = await client.get(quoteUrl(commission.id));
    expect(beforeSend.status).toBe(404);
    expect(beforeSend.body.error.code).toBe('QUOTE_NOT_FOUND');

    await send(admin, commission.id);
    const afterSend = await client.get(quoteUrl(commission.id));
    expect(afterSend.status).toBe(200);
    expect(afterSend.body.data).toMatchObject({ status: 'sent', totalCents: 17_001 });
  });

  it('shows the admin the draft', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await inquiry();
    await generate(agent, commission.id);

    expect((await agent.get(quoteUrl(commission.id))).body.data.status).toBe('draft');
  });

  it("returns 403 for another client's quote and 401 without a session", async () => {
    const { agent } = await loggedInAgent(app);
    const other = await inquiry();

    expect((await agent.get(quoteUrl(other.id))).status).toBe(403);
    expect((await request(app).get(quoteUrl(other.id))).status).toBe(401);
  });
});

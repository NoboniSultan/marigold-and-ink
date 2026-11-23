/**
 * Giving (milestone 8, ADR 0013): the final payment records trees, they're requested from
 * a fake Digital Humani, retries never plant twice, and refunds never give back tree money.
 * createQuotedCommission: total 10,000, deposit 5,000, balance 5,000 cents → 25% = 25 trees.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { seedCharity } from '../../../db/seeds/charity.ts';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createPayment, createQuotedCommission } from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { checkoutCompleted, fakeStripe, postWebhook } from '../../../../tests/helpers/stripe.ts';
import { fakeTrees } from '../../../../tests/helpers/trees.ts';
import {
  DEFAULT_CHARITY,
  RETRY_AFTER_MINUTES,
  recordForFinalPayment,
  requestPendingTrees,
} from '../giving.service.ts';
import { withTransaction } from '../../../db/transaction.ts';

let stripe: ReturnType<typeof fakeStripe>;
let trees: ReturnType<typeof fakeTrees>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  await seedCharity();
  stripe = fakeStripe();
  trees = fakeTrees();
  app = createApp({
    adapters: { email: null, google: null, payments: stripe.gateway, trees: trees.planter },
    donationPercent: 25,
  });
});

/** A client's commission waiting at `status`, with the client's logged-in agent. */
async function commissionFor(status: string) {
  const { agent, user } = await loggedInAgent(app);
  const commission = await createQuotedCommission({ clientId: user.id, status });
  return { agent, commission };
}

/** The client pays the stage through the fake Stripe, and the webhook confirms it. */
async function payStage(
  agent: ReturnType<typeof request.agent>,
  commissionId: number,
  type: 'deposit' | 'final',
) {
  const started = await agent
    .post(`/api/v1/commissions/${commissionId}/payments/${type}`)
    .set('Origin', TRUSTED_ORIGIN);
  const sessionId = (started.body.data.url as string).split('/').pop()!;
  const event = checkoutCompleted({ sessionId, amountCents: 5000 });
  const res = await postWebhook(app, event);
  expect(res.status).toBe(200);
  return event;
}

/** A commission paid in full: deposit, then the final payment (which records the trees). */
async function fullyPaid() {
  const { agent, commission } = await commissionFor('quoted');
  await payStage(agent, commission.id, 'deposit');
  await pool.query(`UPDATE commissions SET status = 'awaiting_final_payment' WHERE id = $1`, [
    commission.id,
  ]);
  await payStage(agent, commission.id, 'final');
  return commission;
}

async function donations() {
  const { rows } = await pool.query(
    `SELECT d.commission_id, d.tree_count, d.donation_amount_cents, d.base_amount_cents,
            d.percentage::float AS percentage, d.status, d.tree_request_id, d.request_attempted_at,
            c.name AS charity
       FROM donations d JOIN charities c ON c.id = d.charity_id ORDER BY d.id`,
  );
  return rows;
}

/**
 * The webhook starts the first tree request in the background. Wait until that attempt has
 * failed (it used up `failNext.plant`) and stamped the row, so the test's own retry can't
 * race it.
 */
const waitForFailedAttempt = () =>
  vi.waitFor(async () => {
    expect(trees.failNext.plant).toBe(false);
    expect((await donations())[0]).toMatchObject({
      status: 'pending',
      request_attempted_at: expect.any(Date),
    });
  });
const waitForRequests = (count: number) =>
  vi.waitFor(() => expect(trees.requests).toHaveLength(count));

describe('the final payment funds trees', () => {
  it('records 25% of the full price as trees, then requests them from Digital Humani', async () => {
    const commission = await fullyPaid();
    await waitForRequests(1);
    await vi.waitFor(async () => expect((await donations())[0].status).toBe('owed'));

    expect(await donations()).toEqual([
      {
        commission_id: commission.id,
        tree_count: 25,
        donation_amount_cents: 2500,
        base_amount_cents: 10000,
        percentage: 25,
        status: 'owed',
        tree_request_id: 'tree-req-1',
        request_attempted_at: expect.any(Date),
        charity: DEFAULT_CHARITY.name,
      },
    ]);
    // Digital Humani only ever sees our reference, never a client's name or email.
    expect(trees.requests).toEqual([
      { uuid: 'tree-req-1', treeCount: 25, reference: `commission-${commission.id}` },
    ]);
  });

  it('records nothing for a deposit', async () => {
    const { agent, commission } = await commissionFor('quoted');
    await payStage(agent, commission.id, 'deposit');

    expect(await donations()).toEqual([]);
  });

  it('records the trees once, however often Stripe replays the event', async () => {
    const { agent, commission } = await commissionFor('awaiting_final_payment');
    const event = await payStage(agent, commission.id, 'final');
    await waitForRequests(1);

    const replay = await postWebhook(app, event);

    expect(replay.body.duplicate).toBe(true);
    expect(await donations()).toHaveLength(1);
    expect(trees.requests).toHaveLength(1);
  });

  it('records nothing while giving is off', async () => {
    app = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
    const { agent, commission } = await commissionFor('awaiting_final_payment');
    await payStage(agent, commission.id, 'final');

    expect(await donations()).toEqual([]);
  });

  it('still takes the payment if no charity is active, and logs the problem', async () => {
    await pool.query('UPDATE charities SET is_active = false');
    const { agent, commission } = await commissionFor('awaiting_final_payment');
    await payStage(agent, commission.id, 'final');

    const { rows } = await pool.query('SELECT status FROM commissions WHERE id = $1', [
      commission.id,
    ]);
    expect(rows[0].status).toBe('delivered');
    expect(await donations()).toEqual([]);
  });
});

describe('requestPendingTrees (retries)', () => {
  it('leaves a failed request pending, and sends it on the next try', async () => {
    trees.failNext.plant = true;
    await fullyPaid();
    await waitForFailedAttempt();
    // The failed attempt is recent, so an immediate retry leaves it alone (it may be in flight).
    expect(await requestPendingTrees(trees.planter)).toEqual({ requested: 0, failed: 0 });

    await pool.query(
      `UPDATE donations SET request_attempted_at = now() - make_interval(mins => $1)`,
      [RETRY_AFTER_MINUTES + 1],
    );
    expect(await requestPendingTrees(trees.planter)).toEqual({ requested: 1, failed: 0 });
    expect((await donations())[0]).toMatchObject({ status: 'owed', tree_request_id: 'tree-req-1' });
    expect(trees.requests).toHaveLength(1);
  });

  it('adopts a request that went through without an answer, instead of planting twice', async () => {
    trees.failNext.loseAnswer = true;
    await fullyPaid();
    await waitForRequests(1);
    await pool.query(
      `UPDATE donations SET request_attempted_at = now() - make_interval(mins => $1)`,
      [RETRY_AFTER_MINUTES + 1],
    );

    expect(await requestPendingTrees(trees.planter)).toEqual({ requested: 1, failed: 0 });

    expect(trees.requests).toHaveLength(1);
    expect((await donations())[0]).toMatchObject({ status: 'owed', tree_request_id: 'tree-req-1' });
  });

  it('counts a failure to check Digital Humani as failed, and keeps the row pending', async () => {
    trees.failNext.plant = true;
    await fullyPaid();
    await waitForFailedAttempt();
    await pool.query(
      `UPDATE donations SET request_attempted_at = now() - make_interval(mins => $1)`,
      [RETRY_AFTER_MINUTES + 1],
    );
    trees.failNext.find = true;

    expect(await requestPendingTrees(trees.planter)).toEqual({ requested: 0, failed: 1 });
    expect((await donations())[0].status).toBe('pending');
  });

  it("ignores an earlier request that isn't this donation's, and plants it", async () => {
    trees.failNext.plant = true;
    const commission = await fullyPaid();
    await waitForFailedAttempt();
    // A request under the same reference, but for a different number of trees.
    trees.requests.push({
      uuid: 'unrelated',
      treeCount: 3,
      reference: `commission-${commission.id}`,
    });
    await pool.query(
      `UPDATE donations SET request_attempted_at = now() - make_interval(mins => $1)`,
      [RETRY_AFTER_MINUTES + 1],
    );

    expect(await requestPendingTrees(trees.planter)).toEqual({ requested: 1, failed: 0 });
    expect((await donations())[0]).toMatchObject({ status: 'owed', tree_request_id: 'tree-req-1' });
  });

  it('does nothing without Digital Humani configured', async () => {
    expect(await requestPendingTrees(null)).toEqual({ requested: 0, failed: 0 });
  });
});

describe('recordForFinalPayment', () => {
  it('records one donation per payment, even if called twice (the database guards it)', async () => {
    const commission = await createQuotedCommission();
    const payment = await createPayment({ commissionId: commission.id, type: 'final' });
    const record = () =>
      withTransaction((client) =>
        recordForFinalPayment(
          { commissionId: commission.id, paymentId: payment.id, totalCents: 10000 },
          { client, donationPercent: 25 },
        ),
      );

    expect(await record()).toEqual(expect.any(Number));
    expect(await record()).toBeNull();
    expect(await donations()).toHaveLength(1);
  });

  it('records nothing when the commission is too small to fund one whole tree', async () => {
    const commission = await createQuotedCommission({
      quotedTotalCents: 99,
      depositCents: 50,
      balanceCents: 49,
    });
    const id = await withTransaction((client) =>
      recordForFinalPayment(
        { commissionId: commission.id, paymentId: 1, totalCents: 99 },
        { client, donationPercent: 25 },
      ),
    );
    expect(id).toBeNull();
  });
});

describe('refunds never give back tree money', () => {
  const refund = (agent: ReturnType<typeof request.agent>, commissionId: number, body: object) =>
    agent
      .post(`/api/v1/admin/commissions/${commissionId}/refunds`)
      .set('Origin', TRUSTED_ORIGIN)
      .send(body);

  async function paymentIds(commissionId: number) {
    const { rows } = await pool.query(
      `SELECT id, type FROM payments WHERE commission_id = $1 AND type <> 'refund' ORDER BY id`,
      [commissionId],
    );
    return { deposit: rows[0].id as number, final: rows[1].id as number };
  }

  it('refunds everything except the $25 that went to trees', async () => {
    const commission = await fullyPaid();
    const { deposit, final } = await paymentIds(commission.id);
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });

    const first = await refund(admin, commission.id, { paymentId: final, reason: 'Client asked' });
    expect(first.status).toBe(201);
    expect(first.body.data.amountCents).toBe(5000);

    // A full refund of the deposit stops short of the tree money: 5,000 − 2,500.
    const second = await refund(admin, commission.id, {
      paymentId: deposit,
      reason: 'Client asked',
    });
    expect(second.status).toBe(201);
    expect(second.body.data.amountCents).toBe(2500);

    const third = await refund(admin, commission.id, { paymentId: deposit, reason: 'More' });
    expect(third.status).toBe(422);
    expect(third.body.error).toMatchObject({
      code: 'ALREADY_REFUNDED',
      message: 'Everything else has been refunded; the rest went to planting trees',
      details: { remainingCents: 0, withheldForTreesCents: 2500 },
    });
    expect(stripe.calls.refunds.map((r) => r.amountCents)).toEqual([5000, 2500]);
  });

  it('refuses an amount that would reach into the tree money', async () => {
    const commission = await fullyPaid();
    const { deposit, final } = await paymentIds(commission.id);
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });
    await refund(admin, commission.id, { paymentId: final, reason: 'Client asked' });

    const res = await refund(admin, commission.id, {
      paymentId: deposit,
      amountCents: 5000,
      reason: 'Client asked',
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
      details: { remainingCents: 2500, withheldForTreesCents: 2500 },
    });
  });

  it('still refunds a deposit in full before the commission is fully paid (no trees yet)', async () => {
    const { agent, commission } = await commissionFor('quoted');
    await payStage(agent, commission.id, 'deposit');
    const { rows } = await pool.query(`SELECT id FROM payments WHERE commission_id = $1`, [
      commission.id,
    ]);
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });

    const res = await refund(admin, commission.id, { paymentId: rows[0].id, reason: 'Cancelled' });

    expect(res.status).toBe(201);
    expect(res.body.data.amountCents).toBe(5000);
  });
});

describe('GET /api/v1/giving', () => {
  it('is public, and counts the trees funded so far', async () => {
    expect((await request(app).get('/api/v1/giving')).body).toEqual({ data: { trees: 0 } });

    await fullyPaid();
    const res = await request(app).get('/api/v1/giving');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { trees: 25 } });
  });
});

describe('seedCharity', () => {
  it('is idempotent, and never replaces a charity the owner made active', async () => {
    expect(await seedCharity()).toBe('unchanged');

    await pool.query('UPDATE charities SET is_active = false');
    expect(await seedCharity()).toBe('activated');

    await pool.query('UPDATE charities SET is_active = false');
    await pool.query(`INSERT INTO charities (name, is_active) VALUES ('Another charity', true)`);
    expect(await seedCharity()).toBe('unchanged');
  });

  it('creates the charity on an empty database', async () => {
    await truncateAllTables();
    expect(await seedCharity()).toBe('created');
  });
});

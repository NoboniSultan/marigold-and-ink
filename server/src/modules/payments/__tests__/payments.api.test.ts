import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createPayment,
  createQuotedCommission,
  createUser,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import {
  checkoutCompleted,
  checkoutExpired,
  fakeStripe,
  postWebhook,
  refundEvent,
} from '../../../../tests/helpers/stripe.ts';

// createQuotedCommission: total 10,000, deposit 5,000, balance 5,000 cents (test values).
let stripe: ReturnType<typeof fakeStripe>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  stripe = fakeStripe();
  app = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
});

type Agent = ReturnType<typeof request.agent>;

const pay = (agent: Agent | ReturnType<typeof request>, id: number | string, type = 'deposit') =>
  agent.post(`/api/v1/commissions/${id}/payments/${type}`).set('Origin', TRUSTED_ORIGIN);

const refund = (agent: Agent, id: number, body: object) =>
  agent.post(`/api/v1/admin/commissions/${id}/refunds`).set('Origin', TRUSTED_ORIGIN).send(body);

const sessionIdOf = (res: request.Response) => (res.body.data.url as string).split('/').pop()!;

async function statusOf(commissionId: number) {
  const { rows } = await pool.query('SELECT status FROM commissions WHERE id = $1', [commissionId]);
  return rows[0].status;
}

async function paymentsOf(commissionId: number) {
  const { rows } = await pool.query(
    `SELECT id, type, status, amount_cents, stripe_payment_intent_id, stripe_refund_id, reason,
            requested_by_user_id
       FROM payments WHERE commission_id = $1 ORDER BY id`,
    [commissionId],
  );
  return rows;
}

async function eventsOf(commissionId: number) {
  const { rows } = await pool.query(
    `SELECT from_status, to_status, actor_type, actor_user_id, reason, metadata
       FROM commission_events WHERE commission_id = $1 ORDER BY id`,
    [commissionId],
  );
  return rows;
}

const count = async (table: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

/** A client with a quoted commission. */
async function quotedForClient(overrides: Record<string, unknown> = {}) {
  const { agent, user } = await loggedInAgent(app);
  const commission = await createQuotedCommission({ clientId: user.id, ...overrides });
  return { agent, user, commission };
}

/** Runs the whole deposit: Checkout, then Stripe's webhook. */
async function paidDeposit() {
  const setup = await quotedForClient();
  const started = await pay(setup.agent, setup.commission.id);
  const sessionId = sessionIdOf(started);
  await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 5000 }));
  const [deposit] = await paymentsOf(setup.commission.id);
  return { ...setup, sessionId, deposit };
}

describe('POST /commissions/:id/payments/deposit', () => {
  it('creates a Stripe Checkout page for the deposit stored on the quote', async () => {
    const { agent, user, commission } = await quotedForClient();

    const res = await pay(agent, commission.id).send({ amountCents: 1 }); // ignored

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//),
      reused: false,
    });
    const [payment] = await paymentsOf(commission.id);
    expect(payment).toMatchObject({ type: 'deposit', status: 'pending', amount_cents: 5000 });
    expect(stripe.calls.checkout).toHaveLength(1);
    expect(stripe.calls.checkout[0]).toMatchObject({
      idempotencyKey: `checkout-payment-${payment.id}`,
      request: {
        type: 'deposit',
        amountCents: 5000,
        currency: 'usd',
        customerEmail: user.email,
        successUrl: `https://marigold.test/commissions/${commission.id}?payment=success`,
        cancelUrl: `https://marigold.test/commissions/${commission.id}?payment=cancelled`,
      },
    });
  });

  it('gives a second click the same open page instead of creating another', async () => {
    const { agent, commission } = await quotedForClient();
    const first = await pay(agent, commission.id);

    const second = await pay(agent, commission.id);

    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ url: first.body.data.url, reused: true });
    expect(stripe.calls.checkout).toHaveLength(1);
  });

  it('makes a new page when the open one is about to expire', async () => {
    const { agent, commission } = await quotedForClient();
    await pay(agent, commission.id);
    await pool.query(`UPDATE payments SET checkout_expires_at = now() + interval '5 minutes'`);

    const res = await pay(agent, commission.id);

    expect(res.status).toBe(201);
    expect(stripe.calls.checkout).toHaveLength(2);
  });

  it('is for the commission’s own client only', async () => {
    const { commission } = await quotedForClient();
    const { agent: other } = await loggedInAgent(app);
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });

    expect((await pay(other, commission.id)).status).toBe(403);
    const byAdmin = await pay(admin, commission.id);
    expect(byAdmin.status).toBe(403);
    expect(byAdmin.body.error.code).toBe('PAYMENT_CLIENT_ONLY');
    expect((await pay(request(app), commission.id)).status).toBe(401);
    expect(await count('payments')).toBe(0);
  });

  it('refuses at the wrong stage (409), and answers 404 and 400 for bad commissions', async () => {
    const { agent, commission } = await quotedForClient({ status: 'deposit_paid' });

    const res = await pay(agent, commission.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'PAYMENT_NOT_ALLOWED',
      details: { status: 'deposit_paid', type: 'deposit' },
    });
    expect((await pay(agent, commission.id, 'final')).status).toBe(409);
    expect((await pay(agent, 999999)).status).toBe(404);
    expect((await pay(agent, 'abc')).status).toBe(400);
    expect((await pay(agent, commission.id, 'tip')).status).toBe(400);
  });

  it('refuses when there is nothing to pay (422)', async () => {
    const { agent, commission } = await quotedForClient({ depositCents: 0, balanceCents: 10000 });

    const res = await pay(agent, commission.id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOTHING_TO_PAY');
  });

  it('treats an unexpected error as a 500, also recording nothing', async () => {
    const broken = createApp({
      adapters: {
        email: null,
        google: null,
        payments: {
          ...stripe.gateway,
          createCheckoutSession: async () => {
            throw new TypeError('a bug, not Stripe');
          },
        },
      },
    });
    const { agent, user } = await loggedInAgent(broken);
    const commission = await createQuotedCommission({ clientId: user.id });

    expect((await pay(agent, commission.id)).status).toBe(500);
    expect(await count('payments')).toBe(0);
  });

  it('records nothing when Stripe is down (502)', async () => {
    const { agent, commission } = await quotedForClient();
    stripe.failNext('checkout');

    const res = await pay(agent, commission.id);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect(res.body.error.message).not.toMatch(/outage/); // Stripe's message stays in the logs
    expect(await count('payments')).toBe(0);
  });

  it('is unavailable (503) when payments are not configured', async () => {
    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    const { agent, user } = await loggedInAgent(off);
    const commission = await createQuotedCommission({ clientId: user.id });

    const res = await pay(agent, commission.id);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
  });
});

describe('POST /webhooks/stripe: signature', () => {
  it('refuses an invalid or missing signature, and records nothing', async () => {
    const event = checkoutExpired('cs_x');

    const forged = await postWebhook(app, event, { signature: 't=1,v1=forged' });
    const unsigned = await postWebhook(app, event, { signature: null });

    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(unsigned.status).toBe(400);
    expect(await count('processed_webhook_events')).toBe(0);
  });

  it('accepts a valid signature without a session cookie or Origin header', async () => {
    const res = await postWebhook(app, checkoutExpired('cs_unknown'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('is unavailable (503) when payments are not configured', async () => {
    const off = createApp({ adapters: { email: null, google: null, payments: null } });

    expect((await postWebhook(off, checkoutExpired('cs_x'))).status).toBe(503);
  });
});

describe('POST /webhooks/stripe: deposit', () => {
  it('records the payment and moves the commission to deposit_paid, in one go', async () => {
    const { commission, deposit, sessionId } = await paidDeposit();

    expect(await statusOf(commission.id)).toBe('deposit_paid');
    expect(deposit).toMatchObject({
      type: 'deposit',
      status: 'succeeded',
      stripe_payment_intent_id: `pi_test_${sessionId}`,
    });
    expect((await eventsOf(commission.id)).at(-1)).toEqual({
      from_status: 'quoted',
      to_status: 'deposit_paid',
      actor_type: 'system',
      actor_user_id: null,
      reason: 'Deposit paid',
      metadata: { paymentId: Number(deposit.id), amountCents: 5000 },
    });
  });

  it('has no extra effect when the same event is delivered twice', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));
    const event = checkoutCompleted({ sessionId, amountCents: 5000 });

    const first = await postWebhook(app, event);
    const before = {
      payments: await paymentsOf(commission.id),
      events: await eventsOf(commission.id),
      status: await statusOf(commission.id),
    };
    const replay = await postWebhook(app, event);

    expect(first.body.duplicate).toBe(false);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(await paymentsOf(commission.id)).toEqual(before.payments);
    expect(await eventsOf(commission.id)).toEqual(before.events);
    expect(await statusOf(commission.id)).toBe(before.status);
    expect(await count('processed_webhook_events')).toBe(1);
  });

  it('does nothing more for a second, different event about an already-paid session', async () => {
    const { commission, sessionId } = await paidDeposit();
    const eventsBefore = await eventsOf(commission.id);

    await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 5000 }));

    expect(await eventsOf(commission.id)).toEqual(eventsBefore);
  });

  it('never records an unpaid session as paid', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));

    await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 5000, paid: false }));

    expect((await paymentsOf(commission.id))[0].status).toBe('pending');
    expect(await statusOf(commission.id)).toBe('quoted');
  });

  it('still records a paid session whose amount differs from ours (and logs it)', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));

    await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 4999 }));

    expect(await statusOf(commission.id)).toBe('deposit_paid');
  });

  it('acknowledges events about sessions this app never created, and other event types', async () => {
    const unknown = await postWebhook(
      app,
      checkoutCompleted({ sessionId: 'cs_elsewhere', amountCents: 1 }),
    );
    const other = await postWebhook(app, {
      ...checkoutExpired('cs_x'),
      type: 'customer.created',
    });

    expect(unknown.status).toBe(200);
    expect(other.status).toBe(200);
    expect(await count('payments')).toBe(0);
  });

  it('marks an unpaid page as expired when Stripe closes it', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));

    await postWebhook(app, checkoutExpired(sessionId));

    expect((await paymentsOf(commission.id))[0].status).toBe('expired');
    expect(await statusOf(commission.id)).toBe('quoted');
  });
});

describe('POST /webhooks/stripe: final payment', () => {
  it.each([
    ['digital', 'delivered'],
    ['physical', 'ready_to_ship'],
    ['mixed_media', 'ready_to_ship'],
  ])('moves a %s commission to %s', async (fulfillmentType, expected) => {
    const { agent, commission } = await quotedForClient({
      status: 'awaiting_final_payment',
      fulfillmentType,
    });

    const started = await pay(agent, commission.id, 'final');
    await postWebhook(
      app,
      checkoutCompleted({ sessionId: sessionIdOf(started), amountCents: 5000 }),
    );

    expect(started.status).toBe(201);
    expect(stripe.calls.checkout[0]!.request).toMatchObject({ type: 'final', amountCents: 5000 });
    expect(await statusOf(commission.id)).toBe(expected);
    expect((await eventsOf(commission.id)).at(-1)).toMatchObject({
      from_status: 'awaiting_final_payment',
      to_status: expected,
      actor_type: 'system',
      reason: 'Final payment received',
    });
  });
});

describe('POST /webhooks/stripe: payment that arrives too late', () => {
  it('refunds it automatically and leaves the cancelled commission alone', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));
    await pool.query(`UPDATE commissions SET status = 'canceled' WHERE id = $1`, [commission.id]);

    const res = await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 5000 }));

    expect(res.status).toBe(200);
    expect(await statusOf(commission.id)).toBe('canceled');
    expect(stripe.calls.refunds).toEqual([
      {
        paymentIntentId: `pi_test_${sessionId}`,
        amountCents: 5000,
        idempotencyKey: `auto-refund-${sessionId}`,
      },
    ]);
    const [deposit, refunded] = await paymentsOf(commission.id);
    expect(deposit).toMatchObject({ type: 'deposit', status: 'succeeded' });
    expect(refunded).toMatchObject({
      type: 'refund',
      status: 'succeeded',
      amount_cents: 5000,
      reason: 'Paid while the commission was canceled; refunded automatically',
      requested_by_user_id: null,
    });
  });

  it('rolls everything back if a step fails, so Stripe’s retry is handled in full', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));
    await pool.query(`UPDATE commissions SET status = 'canceled' WHERE id = $1`, [commission.id]);
    const event = checkoutCompleted({ sessionId, amountCents: 5000 });
    stripe.failNext('refund');

    const failed = await postWebhook(app, event);

    expect(failed.status).toBe(500);
    expect(await count('processed_webhook_events')).toBe(0); // not marked as handled
    expect(await paymentsOf(commission.id)).toEqual([
      expect.objectContaining({ type: 'deposit', status: 'pending' }),
    ]);

    const retried = await postWebhook(app, event);

    expect(retried.status).toBe(200);
    expect((await paymentsOf(commission.id)).map((p) => [p.type, p.status])).toEqual([
      ['deposit', 'succeeded'],
      ['refund', 'succeeded'],
    ]);
  });
});

describe('cancelling a quoted commission', () => {
  const cancel = (agent: Agent, id: number) =>
    agent
      .post(`/api/v1/commissions/${id}/transitions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ toStatus: 'canceled' });

  it('closes its open Stripe page', async () => {
    const { agent, commission } = await quotedForClient();
    const sessionId = sessionIdOf(await pay(agent, commission.id));

    expect((await cancel(agent, commission.id)).status).toBe(200);

    expect(stripe.calls.expired).toEqual([sessionId]);
    expect((await paymentsOf(commission.id))[0].status).toBe('expired');
  });

  it('still cancels if Stripe can’t be reached (a late payment is refunded instead)', async () => {
    const { agent, commission } = await quotedForClient();
    await pay(agent, commission.id);
    stripe.failNext('expire');

    expect((await cancel(agent, commission.id)).status).toBe(200);

    expect(await statusOf(commission.id)).toBe('canceled');
    expect((await paymentsOf(commission.id))[0].status).toBe('pending');
  });

  it('cancels normally when payments are off, or when an after-cancel step throws', async () => {
    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    const { agent, user } = await loggedInAgent(off);
    const first = await createQuotedCommission({ clientId: user.id });
    const second = await createQuotedCommission({ clientId: user.id });

    expect((await cancel(agent, first.id)).status).toBe(200);

    off.locals.onCommissionStatusChange = async () => {
      throw new Error('follow-up failed');
    };
    expect((await cancel(agent, second.id)).status).toBe(200);
    expect(await statusOf(second.id)).toBe('canceled');
  });
});

describe('POST /admin/commissions/:id/refunds', () => {
  async function admin() {
    return loggedInAgent(app, { role: 'admin' });
  }

  it('refunds a deposit in full: the commission becomes refunded', async () => {
    const { commission, deposit } = await paidDeposit();
    const { agent, user } = await admin();

    const res = await refund(agent, commission.id, {
      paymentId: Number(deposit.id),
      reason: 'Client changed their mind',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'refund',
      status: 'succeeded',
      amountCents: 5000,
      reason: 'Client changed their mind',
      requestedByUserId: user.id,
      refundedPaymentId: Number(deposit.id),
    });
    expect(stripe.calls.refunds[0]).toMatchObject({
      paymentIntentId: deposit.stripe_payment_intent_id,
      amountCents: 5000,
      idempotencyKey: `refund-payment-${res.body.data.id}`,
    });
    expect(await statusOf(commission.id)).toBe('refunded');
    expect((await eventsOf(commission.id)).at(-1)).toMatchObject({
      from_status: 'deposit_paid',
      to_status: 'refunded',
      actor_type: 'admin',
      actor_user_id: user.id,
      reason: 'Fully refunded',
    });
  });

  it('keeps the status on a partial refund, and caps refunds at what was paid', async () => {
    const { commission, deposit } = await paidDeposit();
    const { agent } = await admin();
    const paymentId = Number(deposit.id);

    const partial = await refund(agent, commission.id, {
      paymentId,
      amountCents: 1000,
      reason: 'Goodwill',
    });
    expect(partial.status).toBe(201);
    expect(await statusOf(commission.id)).toBe('deposit_paid');

    const tooMuch = await refund(agent, commission.id, {
      paymentId,
      amountCents: 4001,
      reason: 'x',
    });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.error).toMatchObject({
      code: 'REFUND_EXCEEDS_PAYMENT',
      details: { remainingCents: 4000 },
    });

    const rest = await refund(agent, commission.id, { paymentId, reason: 'The rest' });
    expect(rest.body.data.amountCents).toBe(4000);
    expect(await statusOf(commission.id)).toBe('refunded');

    const again = await refund(agent, commission.id, { paymentId, reason: 'Again' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('ALREADY_REFUNDED');
  });

  it('records a refund Stripe hasn’t finished, and settles it when the webhook confirms', async () => {
    const { commission, deposit } = await paidDeposit();
    const { agent, user } = await admin();
    stripe.setRefundStatus('pending');

    const res = await refund(agent, commission.id, {
      paymentId: Number(deposit.id),
      reason: 'Cancelled by the artist',
    });
    expect(res.body.data.status).toBe('pending');
    expect(await statusOf(commission.id)).toBe('deposit_paid');

    await postWebhook(
      app,
      refundEvent({
        refundId: `re_refund-payment-${res.body.data.id}`,
        paymentIntentId: deposit.stripe_payment_intent_id,
        amountCents: 5000,
        status: 'succeeded',
        refundPaymentId: res.body.data.id,
      }),
    );

    expect((await paymentsOf(commission.id)).at(-1).status).toBe('succeeded');
    expect(await statusOf(commission.id)).toBe('refunded');
    expect((await eventsOf(commission.id)).at(-1)).toMatchObject({
      actor_type: 'admin',
      actor_user_id: user.id,
    });
  });

  it('frees the amount again when Stripe reports the refund failed', async () => {
    const { commission, deposit } = await paidDeposit();
    const { agent } = await admin();
    stripe.setRefundStatus('pending');
    const first = await refund(agent, commission.id, {
      paymentId: Number(deposit.id),
      reason: 'x',
    });

    await postWebhook(
      app,
      refundEvent({
        type: 'refund.failed',
        refundId: `re_refund-payment-${first.body.data.id}`,
        paymentIntentId: deposit.stripe_payment_intent_id,
        amountCents: 5000,
        status: 'failed',
      }),
    );
    stripe.setRefundStatus('succeeded');
    const retry = await refund(agent, commission.id, {
      paymentId: Number(deposit.id),
      reason: 'x',
    });

    expect(retry.status).toBe(201);
    expect(await statusOf(commission.id)).toBe('refunded');
  });

  it('records refunds made in the Stripe Dashboard', async () => {
    const { commission, deposit } = await paidDeposit();

    await postWebhook(
      app,
      refundEvent({
        type: 'refund.created',
        refundId: 're_dashboard',
        paymentIntentId: deposit.stripe_payment_intent_id,
        amountCents: 5000,
      }),
    );

    expect((await paymentsOf(commission.id)).at(-1)).toMatchObject({
      type: 'refund',
      stripe_refund_id: 're_dashboard',
      reason: 'Refunded in the Stripe Dashboard',
      requested_by_user_id: null,
    });
    expect(await statusOf(commission.id)).toBe('refunded');
    expect((await eventsOf(commission.id)).at(-1)).toMatchObject({ actor_type: 'system' });
  });

  it('ignores refund events for payments this app didn’t take', async () => {
    const res = await postWebhook(
      app,
      refundEvent({ refundId: 're_x', paymentIntentId: 'pi_elsewhere', amountCents: 100 }),
    );

    expect(res.status).toBe(200);
    expect(await count('payments')).toBe(0);
  });

  it('ignores a refund event with no payment intent, and a repeated status', async () => {
    const { commission, deposit } = await paidDeposit();
    const noIntent = refundEvent({ refundId: 're_y', paymentIntentId: 'pi_x', amountCents: 1 });
    (noIntent.data.object as Record<string, unknown>).payment_intent = null;
    const dashboard = (status: string) =>
      refundEvent({
        refundId: 're_partial',
        paymentIntentId: deposit.stripe_payment_intent_id,
        amountCents: 100,
        status,
      });

    expect((await postWebhook(app, noIntent)).status).toBe(200);
    await postWebhook(app, dashboard('pending'));
    await postWebhook(app, dashboard('pending')); // a later event, same status

    const refunds = (await paymentsOf(commission.id)).filter((p) => p.type === 'refund');
    expect(refunds).toEqual([expect.objectContaining({ status: 'pending', amount_cents: 100 })]);
  });

  it('moves money only (no status change) after the final payment', async () => {
    const client = await createUser();
    const commission = await createQuotedCommission({
      clientId: client.id,
      status: 'ready_to_ship',
      fulfillmentType: 'physical',
    });
    const deposit = await createPayment({ commissionId: commission.id, type: 'deposit' });
    const final = await createPayment({ commissionId: commission.id, type: 'final' });
    const { agent } = await admin();

    for (const payment of [deposit, final]) {
      const res = await refund(agent, commission.id, { paymentId: payment.id, reason: 'Damaged' });
      expect(res.status).toBe(201);
    }

    expect(await statusOf(commission.id)).toBe('ready_to_ship');
  });

  it('refuses unknown, unfinished, and other commissions’ payments', async () => {
    const { commission, deposit } = await paidDeposit();
    const other = await createQuotedCommission();
    const pending = await createPayment({
      commissionId: commission.id,
      type: 'final',
      status: 'pending',
    });
    const { agent } = await admin();

    const elsewhere = await refund(agent, other.id, { paymentId: Number(deposit.id), reason: 'x' });
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body.error.code).toBe('PAYMENT_NOT_FOUND');
    const unfinished = await refund(agent, commission.id, { paymentId: pending.id, reason: 'x' });
    expect(unfinished.status).toBe(422);
    expect(unfinished.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
  });

  it('validates the body, and is admin only', async () => {
    const { agent: client, commission, deposit } = await paidDeposit();
    const { agent } = await admin();

    for (const body of [
      {},
      { paymentId: 1 },
      { paymentId: 1, reason: ' ' },
      { paymentId: 1, amountCents: 0, reason: 'x' },
    ]) {
      expect((await refund(agent, commission.id, body)).status).toBe(400);
    }
    expect(
      (await refund(client, commission.id, { paymentId: Number(deposit.id), reason: 'x' })).status,
    ).toBe(403);
  });

  it('records nothing when Stripe is down (502)', async () => {
    const { commission, deposit } = await paidDeposit();
    const { agent } = await admin();
    stripe.failNext('refund');

    const res = await refund(agent, commission.id, { paymentId: Number(deposit.id), reason: 'x' });

    expect(res.status).toBe(502);
    expect((await paymentsOf(commission.id)).filter((p) => p.type === 'refund')).toEqual([]);
  });
});

describe('GET /commissions/:id/payments', () => {
  it('lists payments for the client without refund notes, and with them for the admin', async () => {
    const { agent, commission, deposit } = await paidDeposit();
    const { agent: admin } = await loggedInAgent(app, { role: 'admin' });
    await refund(admin, commission.id, {
      paymentId: Number(deposit.id),
      amountCents: 100,
      reason: 'Internal note',
    });

    const forClient = await agent.get(`/api/v1/commissions/${commission.id}/payments`);
    const forAdmin = await admin.get(`/api/v1/commissions/${commission.id}/payments`);

    expect(forClient.body.meta).toEqual({ paymentsEnabled: true, currency: 'usd' });
    expect(forClient.body.data.map((p: { type: string }) => p.type)).toEqual(['deposit', 'refund']);
    expect(forClient.body.data[1]).not.toHaveProperty('reason');
    expect(forAdmin.body.data[1]).toMatchObject({ reason: 'Internal note' });
  });

  it('is for the owner or an admin, and says when payments are off', async () => {
    const { commission } = await quotedForClient();
    const { agent: other } = await loggedInAgent(app);
    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    const { agent: offAgent, user } = await loggedInAgent(off);
    const own = await createQuotedCommission({ clientId: user.id });

    expect((await other.get(`/api/v1/commissions/${commission.id}/payments`)).status).toBe(403);
    expect((await request(app).get(`/api/v1/commissions/${commission.id}/payments`)).status).toBe(
      401,
    );
    expect((await offAgent.get(`/api/v1/commissions/${own.id}/payments`)).body.meta).toMatchObject({
      paymentsEnabled: false,
    });
  });
});

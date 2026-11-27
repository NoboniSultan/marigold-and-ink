/**
 * Trees for shop orders (milestone 12d, ADR 0022): recorded when an order is delivered (by
 * tracking, by the admin, or a pickup collected), on the items only; requested from Digital
 * Humani after commit; and never refunded.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createCharity,
  createOrder,
  createOrderItem,
  createPackingType,
  createProduct,
  createProductPhoto,
  createVariant,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';
import { fakeShipping, TEST_PACKAGING_FEE_CENTS } from '../../../../tests/helpers/shipping.ts';
import {
  checkoutCompleted,
  fakeStripe,
  postWebhook,
  refundEvent,
} from '../../../../tests/helpers/stripe.ts';
import { fakeTrees } from '../../../../tests/helpers/trees.ts';
import { requestPendingTrees } from '../../giving/giving.service.ts';
import type { TrackingInfo } from '../../../adapters/shippo.ts';

type AnyAgent = ReturnType<typeof request.agent> | ReturnType<typeof request>;

let stripe: ReturnType<typeof fakeStripe>;
let shipping: ReturnType<typeof fakeShipping>;
let trees: ReturnType<typeof fakeTrees>;
let app: ReturnType<typeof createApp>;

function buildApp({ donationPercent = 25 as number | null } = {}) {
  return createApp({
    adapters: {
      email: fakeEmail().sender,
      google: null,
      payments: stripe.gateway,
      shipping: shipping.setup,
      trees: trees.planter,
    },
    donationPercent,
    shopOpen: true,
  });
}

beforeEach(async () => {
  await truncateAllTables();
  stripe = fakeStripe();
  shipping = fakeShipping();
  trees = fakeTrees();
  app = buildApp();
  await createCharity({ isActive: true });
});

const post = (agent: AnyAgent, url: string, body: object) =>
  agent.post(url).set('Origin', TRUSTED_ORIGIN).send(body);
const mark = (agent: AnyAgent, orderId: number, toStatus: string) =>
  post(agent, `/api/v1/admin/orders/${orderId}/status`, { toStatus });
const refund = (agent: AnyAgent, orderId: number) =>
  post(agent, `/api/v1/admin/orders/${orderId}/refund`, { reason: 'Returned', restock: false });

/** A paid order: two $4 items ($8, 2 trees at 25%) and $10 of shipping, or a pickup. */
async function paidOrder({
  status = 'shipped',
  pickup = false,
  unitPriceCents = 400,
  quantity = 2,
} = {}) {
  const subtotalCents = unitPriceCents * quantity;
  const order = await createOrder({
    status,
    pickup,
    subtotalCents,
    shippingCents: pickup ? 0 : 1000,
    paidAt: new Date(),
    stripePaymentIntentId: `pi_test_${Math.random().toString(36).slice(2)}`,
  });
  await createOrderItem({ orderId: order.id, unitPriceCents, quantity });
  return { id: Number(order.id), paymentIntentId: order.stripe_payment_intent_id as string };
}

async function donationsFor(orderId: number) {
  const { rows } = await pool.query(
    `SELECT tree_count, base_amount_cents, donation_amount_cents, percentage::float, status
       FROM donations WHERE order_id = $1`,
    [orderId],
  );
  return rows;
}

describe('a delivered order funds trees', () => {
  it('records 25% of the items (not shipping) when marked delivered, then requests them', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder();
    const before = (await admin.agent.get(`/api/v1/admin/orders/${id}`)).body.data;
    expect(before).toMatchObject({ trees: null, refundableCents: 1800 });

    const res = await mark(admin.agent, id, 'delivered');

    expect(res.status).toBe(200);
    expect(await donationsFor(id)).toEqual([
      {
        tree_count: 2,
        base_amount_cents: 800,
        donation_amount_cents: 200,
        percentage: 25,
        status: 'owed',
      },
    ]);
    expect(trees.requests).toEqual([
      expect.objectContaining({ treeCount: 2, reference: `order-${id}` }),
    ]);
    expect(res.body.data).toMatchObject({
      status: 'delivered',
      trees: { count: 2, status: 'owed', amountCents: 200 },
      refundableCents: 1600,
      refundable: true,
    });
  });

  it('records them when a pickup is collected', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder({
      status: 'paid',
      pickup: true,
      unitPriceCents: 9000,
      quantity: 1,
    });

    await mark(admin.agent, id, 'delivered');

    expect(await donationsFor(id)).toMatchObject([{ tree_count: 23, base_amount_cents: 9000 }]);
  });

  it('records nothing while an order is only shipped, or when giving is off', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const shipped = await paidOrder({ status: 'paid' });
    await mark(admin.agent, shipped.id, 'shipped');
    expect(await donationsFor(shipped.id)).toEqual([]);

    app = buildApp({ donationPercent: null });
    const off = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder();
    const res = await mark(off.agent, id, 'delivered');
    expect(res.body.data).toMatchObject({ trees: null, refundableCents: 1800 });
    expect(await donationsFor(id)).toEqual([]);
    expect(trees.requests).toEqual([]);
  });

  it('records them when tracking reports the delivery', async () => {
    const type = await createPackingType({
      name: 'Flat mailer',
      lengthIn: 9.5,
      widthIn: 6.5,
      heightIn: 0.5,
      weightOz: 0.4,
    });
    const product = await createProduct({ published: true, packingTypeId: type.id });
    const variant = await createVariant({ productId: product.id, priceCents: 400, weightOz: 0.3 });
    await createProductPhoto({ productId: product.id });
    const client = await loggedInAgent(app);
    const groundCents = 758 + TEST_PACKAGING_FEE_CENTS;
    const started = await post(client.agent, '/api/v1/orders', {
      items: [{ variantId: Number(variant.id), quantity: 2 }],
      shipping: {
        address: {
          name: 'Ana Client',
          line1: '215 Clayton St',
          line2: null,
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94117',
        },
        serviceToken: 'usps_ground_advantage',
        expectedCents: groundCents,
      },
    });
    const orderId = started.body.data.orderId as number;
    await postWebhook(
      app,
      checkoutCompleted({
        sessionId: `cs_test_order-checkout-${orderId}`,
        amountCents: 800 + groundCents,
      }),
    );
    const admin = await loggedInAgent(app, { role: 'admin' });
    const base = `/api/v1/admin/orders/${orderId}/shipping`;
    const prices = await post(admin.agent, `${base}/label-options`, {});
    await post(admin.agent, `${base}/label`, { rateId: prices.body.data[0].rateId });
    const delivered: TrackingInfo = {
      status: 'delivered',
      details: null,
      updatedAt: new Date(),
      eta: null,
      scans: [],
    };
    shipping.settings.tracking.set('9400TEST1', delivered);

    const res = await post(admin.agent, `${base}/tracking/refresh`, {});

    expect(res.body.data).toMatchObject({
      status: 'delivered',
      trees: { count: 2, status: 'owed' },
      refundableCents: 800 + groundCents - 200,
    });
    expect(trees.requests).toEqual([
      expect.objectContaining({ treeCount: 2, reference: `order-${orderId}` }),
    ]);
  });

  it('retries under the order’s own reference without planting twice', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder();
    trees.failNext.loseAnswer = true; // the request goes through, the answer is lost

    await mark(admin.agent, id, 'delivered');
    expect(await donationsFor(id)).toMatchObject([{ status: 'pending' }]);
    await pool.query(
      "UPDATE donations SET request_attempted_at = now() - interval '10 minutes' WHERE order_id = $1",
      [id],
    );

    expect(await requestPendingTrees(trees.planter)).toEqual({ requested: 1, failed: 0 });
    expect(trees.requests).toHaveLength(1);
    expect(await donationsFor(id)).toMatchObject([{ status: 'owed' }]);
  });
});

describe('refunds never give back an order’s tree money', () => {
  it('refunds everything but the trees once delivered', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder();
    await mark(admin.agent, id, 'delivered');

    const res = await refund(admin.agent, id);

    expect(res.status).toBe(200);
    expect(stripe.calls.refunds.at(-1)!.amountCents).toBe(1600);
    expect(res.body.data).toMatchObject({
      status: 'refunded',
      refundedCents: 1600,
      refundable: false,
      trees: { count: 2 },
    });
    expect(await donationsFor(id)).toMatchObject([{ status: 'owed' }]); // still owed
  });

  it('refunds in full before delivery (no trees yet)', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder();

    await refund(admin.agent, id);

    expect(stripe.calls.refunds.at(-1)!.amountCents).toBe(1800);
    // A refunded order is never delivered, so it never orders trees.
    expect((await mark(admin.agent, id, 'delivered')).status).toBe(409);
    expect(await donationsFor(id)).toEqual([]);
  });

  it('refuses a refund when the trees took everything (a tiny pickup)', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder({
      status: 'paid',
      pickup: true,
      unitPriceCents: 100,
      quantity: 1,
    });
    const delivered = await mark(admin.agent, id, 'delivered');
    expect(delivered.body.data).toMatchObject({ refundableCents: 0, refundable: false });

    const res = await refund(admin.agent, id);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORDER_NOT_REFUNDABLE');
  });

  it('counts a Stripe Dashboard refund of all but the trees as refunded', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id, paymentIntentId } = await paidOrder();
    await mark(admin.agent, id, 'delivered');

    await postWebhook(
      app,
      refundEvent({ refundId: 're_dashboard_1', paymentIntentId, amountCents: 1600 }),
    );

    const { rows } = await pool.query('SELECT status FROM orders WHERE id = $1', [id]);
    expect(rows[0].status).toBe('refunded');
  });
});

describe('giving totals and the admin list', () => {
  it('counts order trees publicly, and lists them for the admin by order', async () => {
    const admin = await loggedInAgent(app, { role: 'admin' });
    const { id } = await paidOrder();
    await mark(admin.agent, id, 'delivered');

    expect((await request(app).get('/api/v1/giving')).body.data).toEqual({ trees: 2 });
    const listed = (await admin.agent.get('/api/v1/admin/donations')).body.data;
    expect(listed).toEqual([
      expect.objectContaining({ orderId: id, commissionId: null, treeCount: 2, status: 'owed' }),
    ]);
  });
});

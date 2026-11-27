/** Shop orders (milestone 12b): the cart, checkout, Stripe's webhook, refunds, and the sweep. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createProduct,
  createProductPhoto,
  createVariant,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';
import {
  checkoutCompleted,
  checkoutExpired,
  fakeStripe,
  postWebhook,
  refundEvent,
} from '../../../../tests/helpers/stripe.ts';

type Agent = ReturnType<typeof request.agent>;
type AnyAgent = Agent | ReturnType<typeof request>;

let stripe: ReturnType<typeof fakeStripe>;
let email: ReturnType<typeof fakeEmail>;
let app: ReturnType<typeof createApp>;

const build = (shopOpen = true, payments: ReturnType<typeof fakeStripe>['gateway'] | null = null) =>
  createApp({
    adapters: { email: email.sender, google: null, payments: payments ?? stripe.gateway },
    shopOpen,
  });

beforeEach(async () => {
  await truncateAllTables();
  stripe = fakeStripe();
  email = fakeEmail();
  app = build();
});

/** A published product with one option (`stock` in stock) and a photo. */
async function forSale({
  name = 'Marigold Stickers',
  option = 'Single',
  priceCents = 400,
  stock = 5,
  published = true,
} = {}) {
  const product = await createProduct({ name, published });
  const variant = await createVariant({ productId: product.id, name: option, priceCents, stock });
  await createProductPhoto({ productId: product.id });
  return { product, variant, id: Number(variant.id) };
}

const preview = (agent: AnyAgent, items: unknown) =>
  agent.post('/api/v1/cart/preview').set('Origin', TRUSTED_ORIGIN).send({ items });
const checkout = (agent: AnyAgent, items: unknown) =>
  agent.post('/api/v1/orders').set('Origin', TRUSTED_ORIGIN).send({ items });
const sessionFor = (orderId: number) => `cs_test_order-checkout-${orderId}`;

async function stock(variantId: number) {
  const { rows } = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [
    variantId,
  ]);
  return Number(rows[0].stock);
}

async function orderRow(id: number) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0];
}

async function movements(variantId: number) {
  const { rows } = await pool.query(
    'SELECT change, reason, order_id FROM inventory_movements WHERE variant_id = $1 ORDER BY id',
    [variantId],
  );
  return rows.map((r) => ({ change: r.change, reason: r.reason, orderId: r.order_id }));
}

/** A client who has checked out (`quantity` of a fresh product) and paid. */
async function paidOrder({ quantity = 2, stockLeft = 5 } = {}) {
  const item = await forSale({ stock: stockLeft });
  const client = await loggedInAgent(app);
  const res = await checkout(client.agent, [{ variantId: item.id, quantity }]);
  expect(res.status).toBe(201);
  const orderId = res.body.data.orderId as number;
  const paid = await postWebhook(
    app,
    checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 400 * quantity }),
  );
  expect(paid.status).toBe(200);
  return { ...item, client, orderId, intent: `pi_test_${sessionFor(orderId)}` };
}

describe('POST /cart/preview', () => {
  it("prices a cart with the shop's current prices and stock", async () => {
    const a = await forSale({ priceCents: 450, stock: 3 });
    const b = await forSale({
      name: 'Blue Vase',
      option: 'One of a kind',
      priceCents: 9000,
      stock: 0,
    });

    const res = await preview(request(app), [
      { variantId: a.id, quantity: 1 },
      { variantId: b.id, quantity: 1 },
      { variantId: a.id, quantity: 1 }, // repeated: added together
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      lines: [
        {
          variantId: a.id,
          productName: 'Marigold Stickers',
          variantName: 'Single',
          unitPriceCents: 450,
          quantity: 2,
          lineCents: 900,
          available: 3,
          ok: true,
          photo: { altText: 'A test photo' },
        },
        { variantId: b.id, unitPriceCents: 9000, available: 0, ok: false },
      ],
      unavailable: [],
      subtotalCents: 9900,
      currency: 'usd',
      ready: false,
    });
  });

  it('lists items that no longer exist or are hidden', async () => {
    const hidden = await forSale({ published: false });
    const res = await preview(request(app), [
      { variantId: hidden.id, quantity: 1 },
      { variantId: 99999, quantity: 1 },
    ]);
    expect(res.body.data).toMatchObject({
      lines: [],
      unavailable: [hidden.id, 99999],
      ready: false,
    });
  });

  it('validates the cart, and never takes a price from it', async () => {
    const a = await forSale();
    for (const items of [
      [],
      [{ variantId: a.id, quantity: 0 }],
      [{ variantId: a.id, quantity: 101 }],
      [{ variantId: a.id, quantity: 1, priceCents: 1 }],
      'not a list',
    ]) {
      expect((await preview(request(app), items)).status).toBe(400);
    }
  });

  it('is closed to visitors until the shop opens, but not to the admin', async () => {
    const closed = build(false);
    const a = await forSale();
    expect((await preview(request(closed), [{ variantId: a.id, quantity: 1 }])).status).toBe(404);
    const { agent } = await loggedInAgent(closed, { role: 'admin' });
    expect((await preview(agent, [{ variantId: a.id, quantity: 1 }])).status).toBe(200);
  });
});

describe('POST /orders (checkout)', () => {
  it('holds the items and opens a Stripe page for the total, for 30 minutes', async () => {
    const a = await forSale({ priceCents: 450, stock: 5 });
    const b = await forSale({ name: 'Cards', option: 'Pack of 5', priceCents: 1200, stock: 2 });
    const { agent, user } = await loggedInAgent(app);
    const before = Date.now();

    const res = await checkout(agent, [
      { variantId: a.id, quantity: 3 },
      { variantId: b.id, quantity: 1 },
    ]);

    expect(res.status).toBe(201);
    const { orderId, url } = res.body.data;
    expect(url).toBe(`https://checkout.stripe.com/c/pay/${sessionFor(orderId)}`);
    expect(await stock(a.id)).toBe(2);
    expect(await stock(b.id)).toBe(1);
    expect(await movements(a.id)).toEqual([{ change: -3, reason: 'reservation', orderId }]);

    const { request: sent, idempotencyKey } = stripe.calls.orderCheckout[0]!;
    expect(idempotencyKey).toBe(`order-checkout-${orderId}`);
    expect(sent).toMatchObject({
      orderId,
      currency: 'usd',
      customerEmail: user.email,
      lines: [
        { name: 'Marigold Stickers (Single)', unitAmountCents: 450, quantity: 3 },
        { name: 'Cards (Pack of 5)', unitAmountCents: 1200, quantity: 1 },
      ],
    });
    expect(sent.successUrl).toMatch(new RegExp(`/orders/${orderId}\\?payment=success$`));
    const minutes = (sent.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(29.9);
    expect(minutes).toBeLessThan(30.1);

    const order = await orderRow(orderId);
    expect(order).toMatchObject({ status: 'pending_payment', subtotal_cents: 2550 });
    expect(order.checkout_url).toBe(url);
  });

  it('refuses what is out of stock or hidden, saying what is left', async () => {
    const a = await forSale({ stock: 2 });
    const hidden = await forSale({ published: false });
    const { agent } = await loggedInAgent(app);

    const short = await checkout(agent, [{ variantId: a.id, quantity: 3 }]);
    expect(short.status).toBe(409);
    expect(short.body.error).toMatchObject({
      code: 'OUT_OF_STOCK',
      details: { items: [{ variantId: a.id, available: 2 }] },
    });
    const gone = await checkout(agent, [{ variantId: hidden.id, quantity: 1 }]);
    expect(gone.body.error.details.items).toEqual([{ variantId: hidden.id, available: 0 }]);
    expect(await stock(a.id)).toBe(2);
    expect(stripe.calls.orderCheckout).toEqual([]);
  });

  it('sells the last piece once, however many buyers try at the same moment', async () => {
    const vase = await forSale({ name: 'Blue Vase', stock: 1 });
    const buyers = await Promise.all([1, 2, 3].map(() => loggedInAgent(app)));

    const results = await Promise.all(
      buyers.map((b) => checkout(b.agent, [{ variantId: vase.id, quantity: 1 }])),
    );

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await stock(vase.id)).toBe(0);
  });

  it('holds nothing when Stripe fails, and answers 502', async () => {
    const a = await forSale({ stock: 4 });
    const { agent } = await loggedInAgent(app);
    stripe.failNext('checkout');

    const res = await checkout(agent, [{ variantId: a.id, quantity: 2 }]);

    expect(res.status).toBe(502);
    expect(await stock(a.id)).toBe(4);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM orders');
    expect(rows[0].n).toBe(0);
  });

  it("replaces the client's earlier unpaid checkout, putting its stock back first", async () => {
    const a = await forSale({ stock: 3 });
    const { agent } = await loggedInAgent(app);
    const first = (await checkout(agent, [{ variantId: a.id, quantity: 2 }])).body.data.orderId;
    stripe.setSessionStatus(sessionFor(first), {
      status: 'open',
      paid: false,
      paymentIntentId: null,
    });

    const second = await checkout(agent, [{ variantId: a.id, quantity: 3 }]);

    expect(second.status).toBe(201);
    expect(stripe.calls.expired).toEqual([sessionFor(first)]);
    expect((await orderRow(first)).status).toBe('canceled');
    expect(await stock(a.id)).toBe(0);
    const { rows } = await pool.query(
      'SELECT actor_type, reason FROM order_events WHERE order_id = $1',
      [first],
    );
    expect(rows).toEqual([{ actor_type: 'client', reason: 'A new checkout was started' }]);
  });

  it('records an earlier checkout as paid if Stripe says it was', async () => {
    const a = await forSale({ stock: 3 });
    const { agent } = await loggedInAgent(app);
    const first = (await checkout(agent, [{ variantId: a.id, quantity: 1 }])).body.data.orderId;
    stripe.setSessionStatus(sessionFor(first), {
      status: 'complete',
      paid: true,
      paymentIntentId: 'pi_first',
    });

    expect((await checkout(agent, [{ variantId: a.id, quantity: 1 }])).status).toBe(201);
    expect((await orderRow(first)).status).toBe('paid');
    expect(await stock(a.id)).toBe(1);
    expect(email.sent).toHaveLength(1); // the confirmation for the first order
  });

  it('needs a login, payments, and (before it opens) the admin', async () => {
    const a = await forSale();
    expect((await checkout(request(app), [{ variantId: a.id, quantity: 1 }])).status).toBe(401);

    const noPayments = createApp({
      adapters: { email: null, google: null, payments: null },
      shopOpen: true,
    });
    const np = await loggedInAgent(noPayments);
    expect((await checkout(np.agent, [{ variantId: a.id, quantity: 1 }])).status).toBe(503);

    const closed = build(false);
    const client = await loggedInAgent(closed);
    expect((await checkout(client.agent, [{ variantId: a.id, quantity: 1 }])).status).toBe(404);
    const admin = await loggedInAgent(closed, { role: 'admin' });
    expect((await checkout(admin.agent, [{ variantId: a.id, quantity: 1 }])).status).toBe(201);
  });
});

describe("Stripe's webhook for orders", () => {
  it('marks the order paid and emails the confirmation, once', async () => {
    const { orderId, client } = await paidOrder({ quantity: 2 });

    const order = await orderRow(orderId);
    expect(order.status).toBe('paid');
    expect(order.stripe_payment_intent_id).toBe(`pi_test_${sessionFor(orderId)}`);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe(client.user.email);
    expect(email.sent[0]!.text).toContain(`Order #${orderId}:`);
    expect(email.sent[0]!.text).toContain('2 × Marigold Stickers (Single): $8.00');
    expect(email.sent[0]!.text).toContain('Total: $8.00');

    // The same event again changes nothing.
    await postWebhook(
      app,
      checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 800, eventId: 'evt_again' }),
    );
    await postWebhook(
      app,
      checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 800, eventId: 'evt_again' }),
    );
    expect(email.sent).toHaveLength(1);
    expect(stripe.calls.refunds).toEqual([]);
  });

  it('puts the stock back when the payment page expires', async () => {
    const a = await forSale({ stock: 3 });
    const { agent } = await loggedInAgent(app);
    const orderId = (await checkout(agent, [{ variantId: a.id, quantity: 2 }])).body.data.orderId;

    await postWebhook(app, checkoutExpired(sessionFor(orderId)));

    expect((await orderRow(orderId)).status).toBe('expired');
    expect(await stock(a.id)).toBe(3);
    expect(await movements(a.id)).toEqual([
      { change: -2, reason: 'reservation', orderId },
      { change: 2, reason: 'release', orderId },
    ]);
    // Expiring twice changes nothing more.
    await postWebhook(app, checkoutExpired(sessionFor(orderId)));
    expect(await stock(a.id)).toBe(3);
  });

  it('refunds a payment that arrives after the order ended', async () => {
    const a = await forSale({ stock: 3 });
    const { agent } = await loggedInAgent(app);
    const orderId = (await checkout(agent, [{ variantId: a.id, quantity: 1 }])).body.data.orderId;
    await postWebhook(app, checkoutExpired(sessionFor(orderId)));

    await postWebhook(app, checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 400 }));

    expect((await orderRow(orderId)).status).toBe('expired');
    expect(stripe.calls.refunds).toEqual([
      {
        paymentIntentId: `pi_test_${sessionFor(orderId)}`,
        amountCents: 400,
        idempotencyKey: `order-auto-refund-${sessionFor(orderId)}`,
        orderId,
      },
    ]);
    const { rows } = await pool.query('SELECT status, reason FROM order_refunds');
    expect(rows).toEqual([
      { status: 'succeeded', reason: 'Paid after the order had expired; refunded automatically' },
    ]);
    expect(email.sent).toEqual([]);
  });

  it('ignores a completed page that was not paid', async () => {
    const a = await forSale();
    const { agent } = await loggedInAgent(app);
    const orderId = (await checkout(agent, [{ variantId: a.id, quantity: 1 }])).body.data.orderId;
    await postWebhook(
      app,
      checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 400, paid: false }),
    );
    expect((await orderRow(orderId)).status).toBe('pending_payment');
  });

  it('still answers Stripe when the confirmation email fails', async () => {
    const a = await forSale();
    const { agent } = await loggedInAgent(app);
    const orderId = (await checkout(agent, [{ variantId: a.id, quantity: 1 }])).body.data.orderId;
    email.failOnce();
    const res = await postWebhook(
      app,
      checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 400 }),
    );
    expect(res.status).toBe(200);
    expect((await orderRow(orderId)).status).toBe('paid');
  });
});

describe('refunds', () => {
  const refund = (agent: AnyAgent, orderId: number, body: object) =>
    agent.post(`/api/v1/admin/orders/${orderId}/refund`).set('Origin', TRUSTED_ORIGIN).send(body);

  it('refunds a paid order in full and puts the items back on sale', async () => {
    const { orderId, id, intent } = await paidOrder({ quantity: 2, stockLeft: 5 });
    const admin = await loggedInAgent(app, { role: 'admin' });
    expect(await stock(id)).toBe(3);

    const res = await refund(admin.agent, orderId, { reason: 'Arrived broken', restock: true });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'refunded',
      refundedCents: 800,
      refundable: false,
      refunds: [{ amountCents: 800, status: 'succeeded', reason: 'Arrived broken', restock: true }],
    });
    expect(stripe.calls.refunds[0]).toMatchObject({
      paymentIntentId: intent,
      amountCents: 800,
      orderId,
    });
    expect(await stock(id)).toBe(5);
    expect((await movements(id)).at(-1)).toEqual({ change: 2, reason: 'return', orderId });
  });

  it('keeps the stock as it is when not restocking, and refunds only once', async () => {
    const { orderId, id } = await paidOrder({ quantity: 1, stockLeft: 2 });
    const admin = await loggedInAgent(app, { role: 'admin' });
    await refund(admin.agent, orderId, { reason: 'Changed mind', restock: false });
    expect(await stock(id)).toBe(1);

    const again = await refund(admin.agent, orderId, { reason: 'Again', restock: true });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('ORDER_NOT_REFUNDABLE');
  });

  it('settles a refund Stripe confirms later, then restocks', async () => {
    const { orderId, id, intent } = await paidOrder({ quantity: 1, stockLeft: 1 });
    const admin = await loggedInAgent(app, { role: 'admin' });
    stripe.setRefundStatus('pending');

    const res = await refund(admin.agent, orderId, { reason: 'Lost', restock: true });
    expect(res.body.data).toMatchObject({ status: 'paid', refundable: false });
    expect(await stock(id)).toBe(0);

    const refundId = res.body.data.refunds[0].id;
    const { rows } = await pool.query('SELECT stripe_refund_id FROM order_refunds WHERE id = $1', [
      refundId,
    ]);
    await postWebhook(
      app,
      refundEvent({
        refundId: rows[0].stripe_refund_id,
        paymentIntentId: intent,
        amountCents: 400,
      }),
    );
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await stock(id)).toBe(1);
  });

  it('records a refund made in the Stripe Dashboard', async () => {
    const { orderId, id, intent } = await paidOrder({ quantity: 2, stockLeft: 2 });

    await postWebhook(
      app,
      refundEvent({ refundId: 're_dashboard_1', paymentIntentId: intent, amountCents: 400 }),
    );
    expect((await orderRow(orderId)).status).toBe('paid'); // half refunded
    await postWebhook(
      app,
      refundEvent({ refundId: 're_dashboard_2', paymentIntentId: intent, amountCents: 400 }),
    );
    expect((await orderRow(orderId)).status).toBe('refunded');
    expect(await stock(id)).toBe(0); // Dashboard refunds never restock on their own
    const { rows } = await pool.query(
      "SELECT actor_type FROM order_events WHERE to_status = 'refunded'",
    );
    expect(rows).toEqual([{ actor_type: 'system' }]);
  });

  it('only refunds paid orders, validates, and is admin only', async () => {
    const a = await forSale();
    const client = await loggedInAgent(app);
    const pending = (await checkout(client.agent, [{ variantId: a.id, quantity: 1 }])).body.data
      .orderId;
    const admin = await loggedInAgent(app, { role: 'admin' });

    expect((await refund(admin.agent, pending, { reason: 'x', restock: false })).status).toBe(422);
    expect((await refund(admin.agent, pending, { reason: '', restock: false })).status).toBe(400);
    expect((await refund(admin.agent, 99999, { reason: 'x', restock: false })).status).toBe(404);
    expect((await refund(client.agent, pending, { reason: 'x', restock: false })).status).toBe(403);
    expect((await refund(request(app), pending, { reason: 'x', restock: false })).status).toBe(401);
  });

  it('records nothing when Stripe fails', async () => {
    const { orderId } = await paidOrder();
    const admin = await loggedInAgent(app, { role: 'admin' });
    stripe.failNext('refund');
    expect((await refund(admin.agent, orderId, { reason: 'x', restock: true })).status).toBe(502);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM order_refunds');
    expect(rows[0].n).toBe(0);
  });
});

describe('reading orders', () => {
  it("shows a client their orders (not ended unpaid ones), and each one's page", async () => {
    const { orderId, client } = await paidOrder({ quantity: 2 });
    const a = await forSale();
    const expired = (await checkout(client.agent, [{ variantId: a.id, quantity: 1 }])).body.data
      .orderId;
    await postWebhook(app, checkoutExpired(sessionFor(expired)));

    const list = await client.agent.get('/api/v1/orders');
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({
      id: orderId,
      status: 'paid',
      subtotalCents: 800,
      checkoutUrl: null,
      items: [
        { productName: 'Marigold Stickers', variantName: 'Single', quantity: 2, lineCents: 800 },
      ],
    });
    const one = await client.agent.get(`/api/v1/orders/${orderId}`);
    expect(one.body.data.paidAt).toEqual(expect.any(String));
  });

  it("keeps orders private, and offers a pending order's payment page", async () => {
    const a = await forSale();
    const owner = await loggedInAgent(app);
    const other = await loggedInAgent(app);
    const orderId = (await checkout(owner.agent, [{ variantId: a.id, quantity: 1 }])).body.data
      .orderId;

    const own = await owner.agent.get(`/api/v1/orders/${orderId}`);
    expect(own.body.data.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);
    expect((await other.agent.get(`/api/v1/orders/${orderId}`)).status).toBe(403);
    expect((await owner.agent.get('/api/v1/orders/99999')).status).toBe(404);
    expect((await request(app).get('/api/v1/orders')).status).toBe(401);
  });

  it('lists every order for the admin, by status, with the client and history', async () => {
    const { orderId, client } = await paidOrder();
    const admin = await loggedInAgent(app, { role: 'admin' });

    const list = await admin.agent.get('/api/v1/admin/orders?status=paid');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].client).toMatchObject({ email: client.user.email });
    expect((await admin.agent.get('/api/v1/admin/orders?status=refunded')).body.data).toEqual([]);
    expect((await admin.agent.get('/api/v1/admin/orders?status=lost')).status).toBe(400);

    const one = await admin.agent.get(`/api/v1/admin/orders/${orderId}`);
    expect(one.body.data).toMatchObject({
      refundable: true,
      events: [{ fromStatus: 'pending_payment', toStatus: 'paid', actorType: 'system' }],
      refunds: [],
    });
    expect((await admin.agent.get('/api/v1/admin/orders/99999')).status).toBe(404);
    expect((await client.agent.get('/api/v1/admin/orders')).status).toBe(403);
  });
});

describe('the release sweep', () => {
  async function pendingOrder(quantity = 1) {
    const a = await forSale({ stock: 3 });
    const { agent } = await loggedInAgent(app);
    const orderId = (await checkout(agent, [{ variantId: a.id, quantity }])).body.data.orderId;
    return { ...a, orderId };
  }
  const later = () => new Date(Date.now() + 40 * 60_000); // past the page and the grace

  it("asks Stripe, and releases an expired page's stock", async () => {
    const { orderId, id } = await pendingOrder(2);
    expect(await app.locals.releaseExpiredOrders()).toEqual({ paid: 0, expired: 0, failed: 0 });

    const { releaseExpiredOrders } = await import('../orders.service.ts');
    const result = await releaseExpiredOrders({
      gateway: stripe.gateway,
      email: null,
      now: later(),
    });

    expect(result).toEqual({ paid: 0, expired: 1, failed: 0 });
    expect(stripe.calls.statusLookups).toEqual([sessionFor(orderId)]);
    expect((await orderRow(orderId)).status).toBe('expired');
    expect(await stock(id)).toBe(3);
  });

  it('records a page Stripe says was paid, and skips one still open', async () => {
    const paid = await pendingOrder();
    const open = await pendingOrder();
    stripe.setSessionStatus(sessionFor(paid.orderId), {
      status: 'complete',
      paid: true,
      paymentIntentId: 'pi_late_webhook',
    });
    stripe.setSessionStatus(sessionFor(open.orderId), {
      status: 'open',
      paid: false,
      paymentIntentId: null,
    });
    const { releaseExpiredOrders } = await import('../orders.service.ts');

    const result = await releaseExpiredOrders({
      gateway: stripe.gateway,
      email: email.sender,
      now: later(),
    });

    expect(result).toEqual({ paid: 1, expired: 0, failed: 0 });
    expect((await orderRow(paid.orderId)).status).toBe('paid');
    expect((await orderRow(open.orderId)).status).toBe('pending_payment');
    expect(email.sent).toHaveLength(1);
  });

  it('leaves a page that completed with a delayed payment alone (its stock stays held)', async () => {
    const { orderId, id } = await pendingOrder(2);
    stripe.setSessionStatus(sessionFor(orderId), {
      status: 'complete',
      paid: false,
      paymentIntentId: 'pi_delayed',
    });
    const { releaseExpiredOrders } = await import('../orders.service.ts');

    expect(
      await releaseExpiredOrders({ gateway: stripe.gateway, email: null, now: later() }),
    ).toEqual({ paid: 0, expired: 0, failed: 0 });
    expect((await orderRow(orderId)).status).toBe('pending_payment');
    expect(await stock(id)).toBe(1);
  });

  it('carries on past a failure, and does nothing without payments', async () => {
    await pendingOrder();
    const { releaseExpiredOrders } = await import('../orders.service.ts');
    stripe.failNext('status');
    expect(
      await releaseExpiredOrders({ gateway: stripe.gateway, email: null, now: later() }),
    ).toEqual({ paid: 0, expired: 0, failed: 1 });
    expect(await releaseExpiredOrders({ gateway: null, email: null })).toEqual({
      paid: 0,
      expired: 0,
      failed: 0,
    });
    const spy = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    expect(
      await releaseExpiredOrders({ gateway: stripe.gateway, email: null, now: later() }),
    ).toEqual({ paid: 0, expired: 0, failed: 0 });
    spy.mockRestore();
  });
});

describe('accounts', () => {
  it("ends a deleted client's unpaid order, puts its stock back, and closes its page", async () => {
    const a = await forSale({ stock: 2 });
    const { agent, user } = await loggedInAgent(app);
    const orderId = (await checkout(agent, [{ variantId: a.id, quantity: 2 }])).body.data.orderId;

    const res = await agent
      .delete('/api/v1/users/me')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: user.password });

    expect(res.status).toBe(204);
    expect((await orderRow(orderId)).status).toBe('canceled');
    expect(await stock(a.id)).toBe(2);
    expect(stripe.calls.expired).toEqual([sessionFor(orderId)]);
  });

  it('includes orders in the data download', async () => {
    const { orderId, client } = await paidOrder();
    const res = await client.agent.get('/api/v1/users/me/export');
    expect(res.body.data.orders.map((o: { id: number }) => o.id)).toEqual([orderId]);
  });
});

describe('the shop and the report', () => {
  it("won't delete a product that was ordered (hide it instead)", async () => {
    const { product, id } = await paidOrder();
    const admin = await loggedInAgent(app, { role: 'admin' });
    await admin.agent
      .patch(`/api/v1/admin/shop/products/${product.id}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ published: false });

    const product409 = await admin.agent
      .delete(`/api/v1/admin/shop/products/${product.id}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(product409.status).toBe(409);
    expect(product409.body.error.code).toBe('PRODUCT_HAS_ORDERS');
    const variant409 = await admin.agent
      .delete(`/api/v1/admin/shop/variants/${id}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(variant409.body.error.code).toBe('PRODUCT_HAS_ORDERS');
  });

  it('reports shop sales and refunds in their own columns', async () => {
    const { orderId } = await paidOrder({ quantity: 2 });
    const admin = await loggedInAgent(app, { role: 'admin' });
    await admin.agent
      .post(`/api/v1/admin/orders/${orderId}/refund`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ reason: 'x', restock: false });

    const res = await admin.agent.get('/api/v1/admin/reports/monthly');
    const month = res.body.data.at(-1);
    expect(month).toMatchObject({
      salesCents: 0,
      shopSalesCents: 800,
      shopRefundsCents: 800,
      netSalesCents: 0,
    });
  });
});

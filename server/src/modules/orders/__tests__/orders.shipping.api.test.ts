/** Shipping shop orders (milestone 12c): packing, live options, checkout, labels, tracking. */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createPackingType,
  createProduct,
  createProductPhoto,
  createVariant,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';
import { fakeShipping, TEST_PACKAGING_FEE_CENTS } from '../../../../tests/helpers/shipping.ts';
import { checkoutCompleted, fakeStripe, postWebhook } from '../../../../tests/helpers/stripe.ts';
import type { TrackingInfo } from '../../../adapters/shippo.ts';

// The fake quotes Ground Advantage 758, Priority 1,210 (offered), Media Mail and UPS (not);
// the test packaging fee is 333 cents.
type AnyAgent = ReturnType<typeof request.agent> | ReturnType<typeof request>;

let stripe: ReturnType<typeof fakeStripe>;
let shipping: ReturnType<typeof fakeShipping>;
let email: ReturnType<typeof fakeEmail>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  stripe = fakeStripe();
  shipping = fakeShipping();
  email = fakeEmail();
  app = createApp({
    adapters: {
      email: email.sender,
      google: null,
      payments: stripe.gateway,
      shipping: shipping.setup,
    },
    shopOpen: true,
  });
});

const MAILER = { name: 'Flat mailer', lengthIn: 9.5, widthIn: 6.5, heightIn: 0.5, weightOz: 0.4 };
const BOX = { name: 'Small box', lengthIn: 8, widthIn: 8, heightIn: 4, weightOz: 5.25 };
const ADDRESS = {
  name: 'Ana Client',
  line1: '215 Clayton St',
  line2: null,
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94117',
};
const GROUND_TOTAL = 758 + TEST_PACKAGING_FEE_CENTS;

/** A published product that ships: one option of `weightOz`, in `packing`. */
async function shippable({
  name = 'Marigold Stickers',
  priceCents = 400,
  stock = 5,
  weightOz = 0.3,
  packing = MAILER,
}: {
  name?: string;
  priceCents?: number;
  stock?: number;
  weightOz?: number;
  packing?: typeof MAILER;
} = {}) {
  const type = await createPackingType(packing);
  const product = await createProduct({ name, published: true, packingTypeId: type.id });
  const variant = await createVariant({
    productId: product.id,
    name: 'Single',
    priceCents,
    stock,
    weightOz,
  });
  await createProductPhoto({ productId: product.id });
  return { product, id: Number(variant.id) };
}

const post = (agent: AnyAgent, url: string, body: object) =>
  agent.post(url).set('Origin', TRUSTED_ORIGIN).send(body);
const options = (agent: AnyAgent, items: object[], address: object = ADDRESS) =>
  post(agent, '/api/v1/cart/shipping-options', { items, address });
const checkout = (agent: AnyAgent, items: object[], shippingChoice?: object) =>
  post(agent, '/api/v1/orders', { items, ...(shippingChoice ? { shipping: shippingChoice } : {}) });
const ground = (expectedCents = GROUND_TOTAL) => ({
  address: ADDRESS,
  serviceToken: 'usps_ground_advantage',
  expectedCents,
});
const sessionFor = (orderId: number) => `cs_test_order-checkout-${orderId}`;

async function orderRow(id: number) {
  const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0];
}

/** A client's paid shipped order (Ground Advantage). */
async function paidShippedOrder() {
  const item = await shippable();
  const client = await loggedInAgent(app);
  const res = await checkout(client.agent, [{ variantId: item.id, quantity: 2 }], ground());
  expect(res.status).toBe(201);
  const orderId = res.body.data.orderId as number;
  await postWebhook(
    app,
    checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 800 + GROUND_TOTAL }),
  );
  email.sent.length = 0; // the confirmation
  const admin = await loggedInAgent(app, { role: 'admin' });
  return { ...item, client, admin, orderId };
}

describe('how a cart arrives', () => {
  it('says whether a cart ships, is a pickup, or is missing shipping details', async () => {
    const stickers = await shippable();
    const chair = await createProduct({ published: true, pickupOnly: true, category: 'upcycled' });
    const chairVariant = await createVariant({ productId: chair.id });
    const draft = await createProduct({ published: true });
    const noWeight = await createVariant({ productId: draft.id });
    const preview = (items: object[]) =>
      post(request(app), '/api/v1/cart/preview', { items }).then((r) => r.body.data.delivery);

    expect(await preview([{ variantId: stickers.id, quantity: 1 }])).toBe('ship');
    expect(
      await preview([
        { variantId: stickers.id, quantity: 1 },
        { variantId: Number(chairVariant.id), quantity: 1 },
      ]),
    ).toBe('pickup');
    expect(await preview([{ variantId: Number(noWeight.id), quantity: 1 }])).toBe('unavailable');
  });
});

describe('POST /cart/shipping-options', () => {
  it('checks the address, packs the order, and prices each USPS service with packaging', async () => {
    const stickers = await shippable({ weightOz: 0.3 });
    const vase = await shippable({ name: 'Bud Vase', weightOz: 2.15, packing: BOX });
    const { agent } = await loggedInAgent(app);

    const res = await options(agent, [
      { variantId: stickers.id, quantity: 3 },
      { variantId: vase.id, quantity: 1 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      address: {
        name: 'Ana Client',
        line1: '215 CLAYTON ST',
        line2: null,
        city: 'SAN FRANCISCO',
        state: 'CA',
        postalCode: '94117-0001',
      },
      options: [
        {
          serviceToken: 'usps_ground_advantage',
          carrier: 'USPS',
          serviceName: 'Ground Advantage',
          estimatedDays: 4,
          postageCents: 758,
          packagingFeeCents: TEST_PACKAGING_FEE_CENTS,
          totalCents: GROUND_TOTAL,
        },
        expect.objectContaining({
          serviceToken: 'usps_priority',
          totalCents: 1210 + TEST_PACKAGING_FEE_CENTS,
        }),
      ],
    });
    // Packed in the largest packing: 3 × 0.3 + 2.15 + the box's 5.25 = 8.3 oz.
    expect(shipping.calls.quote[0]!.parcel).toEqual({
      weightOz: 8.3,
      lengthIn: 8,
      widthIn: 8,
      heightIn: 4,
    });
  });

  it('refuses an undeliverable address, a pickup, and items without shipping details', async () => {
    const stickers = await shippable();
    const { agent } = await loggedInAgent(app);
    shipping.settings.invalidAddress = ['Address not found'];
    const bad = await options(agent, [{ variantId: stickers.id, quantity: 1 }]);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({
      code: 'ADDRESS_NOT_DELIVERABLE',
      details: { messages: ['Address not found'] },
    });
    shipping.settings.invalidAddress = null;

    const chair = await createProduct({ published: true, pickupOnly: true });
    const chairVariant = await createVariant({ productId: chair.id });
    expect(
      (await options(agent, [{ variantId: Number(chairVariant.id), quantity: 1 }])).body.error.code,
    ).toBe('ORDER_IS_PICKUP');
    const bare = await createProduct({ published: true });
    const bareVariant = await createVariant({ productId: bare.id });
    expect(
      (await options(agent, [{ variantId: Number(bareVariant.id), quantity: 1 }])).body.error.code,
    ).toBe('CART_NOT_SHIPPABLE');
  });

  it('needs a login, and validates the address', async () => {
    const stickers = await shippable();
    expect((await options(request(app), [{ variantId: stickers.id, quantity: 1 }])).status).toBe(
      401,
    );
    const { agent } = await loggedInAgent(app);
    expect(
      (await options(agent, [{ variantId: stickers.id, quantity: 1 }], { ...ADDRESS, state: 'ZZ' }))
        .status,
    ).toBe(400);
  });
});

describe('checking out a shipped order', () => {
  it('charges the chosen shipping, records the shipment, and shows it on the order', async () => {
    const stickers = await shippable();
    const { agent } = await loggedInAgent(app);

    const res = await checkout(agent, [{ variantId: stickers.id, quantity: 2 }], ground());

    expect(res.status).toBe(201);
    const orderId = res.body.data.orderId;
    expect(await orderRow(orderId)).toMatchObject({
      subtotal_cents: 800,
      shipping_cents: GROUND_TOTAL,
      pickup: false,
    });
    expect(stripe.calls.orderCheckout[0]!.request.lines).toEqual([
      { name: 'Marigold Stickers (Single)', unitAmountCents: 400, quantity: 2 },
      {
        name: 'Shipping & packaging (USPS Ground Advantage)',
        unitAmountCents: GROUND_TOTAL,
        quantity: 1,
      },
    ]);
    const order = (await agent.get(`/api/v1/orders/${orderId}`)).body.data;
    expect(order).toMatchObject({
      subtotalCents: 800,
      shippingCents: GROUND_TOTAL,
      totalCents: 800 + GROUND_TOTAL,
      pickup: false,
      shipment: {
        address: { line1: '215 CLAYTON ST', postalCode: '94117-0001' },
        package: { weightOz: 1, lengthIn: 9.5 }, // 2 × 0.3 + 0.4
        chosen: { serviceName: 'Ground Advantage', totalCents: GROUND_TOTAL },
        label: null,
      },
    });
  });

  it('refuses a changed price or a gone option, saying what is offered now, and holds nothing', async () => {
    const stickers = await shippable({ stock: 2 });
    const { agent } = await loggedInAgent(app);

    const changed = await checkout(agent, [{ variantId: stickers.id, quantity: 1 }], ground(999));
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('SHIPPING_PRICE_CHANGED');
    expect(changed.body.error.details.options).toHaveLength(2);
    const gone = await checkout(agent, [{ variantId: stickers.id, quantity: 1 }], {
      ...ground(),
      serviceToken: 'usps_media_mail',
    });
    expect(gone.body.error.code).toBe('SHIPPING_OPTION_STALE');
    const none = await checkout(agent, [{ variantId: stickers.id, quantity: 1 }]);
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('SHIPPING_REQUIRED');

    const { rows } = await pool.query('SELECT stock FROM product_variants WHERE id = $1', [
      stickers.id,
    ]);
    expect(rows[0].stock).toBe(2);
    expect(stripe.calls.orderCheckout).toEqual([]);
  });

  it('fills in the address from the last shipped order', async () => {
    const { client } = await paidShippedOrder();
    const res = await client.agent.get('/api/v1/orders/address');
    expect(res.body.data).toMatchObject({ line1: '215 CLAYTON ST', city: 'SAN FRANCISCO' });
    const other = await loggedInAgent(app);
    expect((await other.agent.get('/api/v1/orders/address')).body.data).toBeNull();
  });
});

describe('a pickup order', () => {
  it('checks out without shipping, and is marked collected by hand', async () => {
    const chair = await createProduct({ published: true, pickupOnly: true, category: 'upcycled' });
    const variant = await createVariant({ productId: chair.id, priceCents: 9000, stock: 1 });
    await createProductPhoto({ productId: chair.id });
    const client = await loggedInAgent(app);
    const res = await checkout(client.agent, [{ variantId: Number(variant.id), quantity: 1 }]);
    const orderId = res.body.data.orderId;
    expect(await orderRow(orderId)).toMatchObject({ pickup: true, shipping_cents: 0 });
    await postWebhook(
      app,
      checkoutCompleted({ sessionId: sessionFor(orderId), amountCents: 9000 }),
    );
    const admin = await loggedInAgent(app, { role: 'admin' });

    const before = (await admin.agent.get(`/api/v1/admin/orders/${orderId}`)).body.data;
    expect(before).toMatchObject({ labelOpen: false, manualMoves: ['delivered'], shipment: null });
    email.sent.length = 0;
    const marked = await post(admin.agent, `/api/v1/admin/orders/${orderId}/status`, {
      toStatus: 'delivered',
    });
    expect(marked.body.data.status).toBe('delivered');
    expect(marked.body.data.events.at(-1)).toMatchObject({
      toStatus: 'delivered',
      reason: 'Picked up',
    });
    expect(email.sent).toEqual([]); // nothing was shipped
  });
});

describe('labels and tracking for orders', () => {
  const base = (orderId: number) => `/api/v1/admin/orders/${orderId}/shipping`;
  const track = (status: TrackingInfo['status']): TrackingInfo => ({
    status,
    details: null,
    updatedAt: new Date(),
    eta: null,
    scans: [],
  });

  it('buys, prints, and voids a label, like a commission’s', async () => {
    const { admin, orderId } = await paidShippedOrder();
    expect((await admin.agent.get(`/api/v1/admin/orders/${orderId}`)).body.data).toMatchObject({
      labelOpen: true,
      manualMoves: ['shipped'],
    });

    const prices = await post(admin.agent, `${base(orderId)}/label-options`, {});
    expect(prices.body.data[0]).toMatchObject({
      serviceName: 'Ground Advantage',
      matchesChoice: true,
      paidPostageCents: 758,
    });
    const bought = await post(admin.agent, `${base(orderId)}/label`, {
      rateId: prices.body.data[0].rateId,
    });
    expect(bought.status).toBe(200);
    expect(bought.body.data).toMatchObject({
      labelOpen: false,
      shipment: { label: { trackingNumber: '9400TEST1', voidable: true } },
    });
    expect(shipping.calls.buyLabel[0]!.note).toBe(`Order #${orderId}`);

    const file = await admin.agent.get(`${base(orderId)}/label/file`);
    expect(file.status).toBe(302);
    const voided = await post(admin.agent, `${base(orderId)}/label/void`, {});
    expect(voided.body.data).toMatchObject({ labelOpen: true, shipment: { label: null } });
  });

  it('moves the order with tracking, emailing the client each step with its order page', async () => {
    const { admin, orderId, client } = await paidShippedOrder();
    const prices = await post(admin.agent, `${base(orderId)}/label-options`, {});
    await post(admin.agent, `${base(orderId)}/label`, { rateId: prices.body.data[0].rateId });
    shipping.settings.tracking.set('9400TEST1', track('delivered'));

    const res = await post(admin.agent, `${base(orderId)}/tracking/refresh`, {});

    expect(res.body.data.status).toBe('delivered');
    expect(res.body.data.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'paid',
      'shipped',
      'delivered',
    ]);
    expect(email.sent.map((m) => [m.to, m.subject])).toEqual([
      [client.user.email, 'Your Marigold & Ink order is on its way!'],
      [client.user.email, 'Your Marigold & Ink order has arrived!'],
    ]);
    expect(email.sent[0]!.text).toContain(`/orders/${orderId}`);
    expect(email.sent[0]!.text).toContain('Tracking number: 9400TEST1');

    // The client sees the tracking on their order.
    const seen = (await client.agent.get(`/api/v1/orders/${orderId}`)).body.data.shipment.label;
    expect(seen).toMatchObject({
      trackingStatus: 'delivered',
      postageCents: null,
      voidable: false,
    });
  });

  it('is followed by the daily check too', async () => {
    const { admin, orderId } = await paidShippedOrder();
    const prices = await post(admin.agent, `${base(orderId)}/label-options`, {});
    await post(admin.agent, `${base(orderId)}/label`, { rateId: prices.body.data[0].rateId });
    shipping.settings.tracking.set('9400TEST1', track('transit'));

    expect(await app.locals.refreshTracking()).toMatchObject({ labels: 1, failed: 0 });
    expect((await orderRow(orderId)).status).toBe('shipped');
  });

  it('can be marked shipped and delivered by hand, emailing the client', async () => {
    const { admin, orderId, client } = await paidShippedOrder();
    const shipped = await post(admin.agent, `/api/v1/admin/orders/${orderId}/status`, {
      toStatus: 'shipped',
    });
    expect(shipped.body.data).toMatchObject({ status: 'shipped', manualMoves: ['delivered'] });
    expect(email.sent.map((m) => m.to)).toEqual([client.user.email]);
    expect(email.sent[0]!.text).not.toContain('Tracking number'); // no label

    const skip = await post(admin.agent, `/api/v1/admin/orders/${orderId}/status`, {
      toStatus: 'shipped',
    });
    expect(skip.status).toBe(409);
    expect(
      (
        await post(client.agent, `/api/v1/admin/orders/${orderId}/status`, {
          toStatus: 'delivered',
        })
      ).status,
    ).toBe(403);
  });

  it('refunds a shipped order in full, shipping included', async () => {
    const { admin, orderId } = await paidShippedOrder();
    await post(admin.agent, `/api/v1/admin/orders/${orderId}/status`, { toStatus: 'shipped' });

    const res = await post(admin.agent, `/api/v1/admin/orders/${orderId}/refund`, {
      reason: 'Lost in the mail',
      restock: false,
    });

    expect(res.body.data).toMatchObject({ status: 'refunded', refundedCents: 800 + GROUND_TOTAL });
    expect(stripe.calls.refunds.at(-1)!.amountCents).toBe(800 + GROUND_TOTAL);
  });
});

describe('reports and accounts', () => {
  it('counts shop shipping in the report', async () => {
    const { admin } = await paidShippedOrder();
    const month = (await admin.agent.get('/api/v1/admin/reports/monthly')).body.data.at(-1);
    expect(month).toMatchObject({
      shopSalesCents: 800 + GROUND_TOTAL,
      shippingCents: GROUND_TOTAL,
      netSalesCents: 800 + GROUND_TOTAL,
    });
  });

  it("removes the name and street from a deleted client's order shipments", async () => {
    const { client, orderId } = await paidShippedOrder();
    await client.agent
      .delete('/api/v1/users/me')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: client.user.password });
    const { rows } = await pool.query(
      'SELECT recipient_name, address_line1, city FROM shipments WHERE order_id = $1',
      [orderId],
    );
    expect(rows[0]).toEqual({ recipient_name: null, address_line1: null, city: 'SAN FRANCISCO' });
  });
});

/** Shipping a physical commission (milestone 11a), with fake Shippo and Stripe. */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createQuotedCommission, createUser } from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import {
  fakeShipping,
  TEST_FROM,
  TEST_PACKAGING_FEE_CENTS,
} from '../../../../tests/helpers/shipping.ts';
import { checkoutCompleted, fakeStripe, postWebhook } from '../../../../tests/helpers/stripe.ts';

// createQuotedCommission: total 10,000, deposit 5,000, balance 5,000 cents (test values).
// The fake quotes Priority 1,210, Ground Advantage 758, Media Mail 400, UPS Ground 900.
type Agent = ReturnType<typeof request.agent>;

let shipping: ReturnType<typeof fakeShipping>;
let stripe: ReturnType<typeof fakeStripe>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  shipping = fakeShipping();
  stripe = fakeStripe();
  app = createApp({
    adapters: { email: null, google: null, payments: stripe.gateway, shipping: shipping.setup },
  });
});

const ADDRESS = {
  name: 'Ana Client',
  line1: '215 Clayton St',
  line2: '',
  city: 'San Francisco',
  state: 'ca',
  postalCode: '94117',
};
const PACKAGE = { weightOz: 12, lengthIn: 18, widthIn: 14, heightIn: 0.5 };

const base = (id: number) => `/api/v1/commissions/${id}/shipping`;
const getShipping = (agent: Agent | ReturnType<typeof request>, id: number) => agent.get(base(id));
const putAddress = (
  agent: Agent | ReturnType<typeof request>,
  id: number,
  body: object = ADDRESS,
) =>
  agent
    .put(`${base(id)}/address`)
    .set('Origin', TRUSTED_ORIGIN)
    .send(body);
const putPackage = (
  agent: Agent | ReturnType<typeof request>,
  id: number,
  body: object = PACKAGE,
) =>
  agent
    .put(`/api/v1/admin/commissions/${id}/shipping/package`)
    .set('Origin', TRUSTED_ORIGIN)
    .send(body);
const getOptions = (agent: Agent | ReturnType<typeof request>, id: number) =>
  agent.post(`${base(id)}/options`).set('Origin', TRUSTED_ORIGIN);
const choose = (agent: Agent | ReturnType<typeof request>, id: number, rateId: unknown) =>
  agent
    .put(`${base(id)}/choice`)
    .set('Origin', TRUSTED_ORIGIN)
    .send({ rateId });
const payFinal = (agent: Agent, id: number) =>
  agent.post(`/api/v1/commissions/${id}/payments/final`).set('Origin', TRUSTED_ORIGIN);

/** A client with a physical commission at `status`, and an admin. */
async function setup(status = 'awaiting_final_payment', overrides: Record<string, unknown> = {}) {
  const client = await loggedInAgent(app);
  const admin = await loggedInAgent(app, { role: 'admin' });
  const commission = await createQuotedCommission({
    clientId: client.user.id,
    status,
    fulfillmentType: 'physical',
    ...overrides,
  });
  return {
    client: client.agent,
    user: client.user,
    admin: admin.agent,
    id: commission.id as number,
  };
}

/** Address and package in, options fetched; returns the options. */
async function readyToChoose(s: Awaited<ReturnType<typeof setup>>) {
  expect((await putAddress(s.client, s.id)).status).toBe(200);
  expect((await putPackage(s.admin, s.id)).status).toBe(200);
  const res = await getOptions(s.client, s.id);
  expect(res.status).toBe(200);
  return res.body.data as { rateId: string; serviceName: string; totalCents: number }[];
}

async function shipmentRow(commissionId: number) {
  const { rows } = await pool.query('SELECT * FROM shipments WHERE commission_id = $1', [
    commissionId,
  ]);
  return rows[0];
}

describe('GET /commissions/:id/shipping', () => {
  it('shows nothing yet, and what can be done, for a physical commission', async () => {
    const s = await setup('in_progress');

    const res = await getShipping(s.client, s.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: null,
      meta: { shippingEnabled: true, ships: true, addressOpen: true, choosingOpen: false },
    });
  });

  it('says digital and mixed-media work does not ship', async () => {
    const s = await setup('in_progress', { fulfillmentType: 'mixed_media' });
    expect((await getShipping(s.client, s.id)).body.meta).toMatchObject({
      ships: false,
      addressOpen: false,
      choosingOpen: false,
    });
  });

  it('says when shipping is switched off', async () => {
    const s = await setup();
    const off = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
    const { agent } = await loggedInAgent(off, { role: 'admin' });
    const res = await getShipping(agent, s.id);
    expect(res.body.meta).toMatchObject({ shippingEnabled: false, choosingOpen: true });
  });

  it('needs a login, and keeps other clients out', async () => {
    const s = await setup();
    const other = await loggedInAgent(app);

    expect((await getShipping(request(app), s.id)).status).toBe(401);
    const res = await getShipping(other.agent, s.id);
    expect(res.status).toBe(403);
  });

  it('answers 404 for a commission that does not exist', async () => {
    const s = await setup();
    expect((await getShipping(s.client, 999_999)).status).toBe(404);
  });
});

describe('PUT /commissions/:id/shipping/address', () => {
  it("stores the carrier's standard form of the address", async () => {
    const s = await setup('deposit_paid');

    const res = await putAddress(s.client, s.id);

    expect(res.status).toBe(200);
    expect(res.body.data.address).toEqual({
      name: 'Ana Client',
      line1: '215 CLAYTON ST',
      line2: null,
      city: 'SAN FRANCISCO',
      state: 'CA',
      postalCode: '94117-0001',
    });
    expect(shipping.calls.checkAddress[0]).toEqual({
      name: 'Ana Client',
      street1: '215 Clayton St',
      street2: null,
      city: 'San Francisco',
      state: 'CA',
      zip: '94117',
    });
    expect((await getShipping(s.client, s.id)).body.data.address.line1).toBe('215 CLAYTON ST');
  });

  it('lets the admin set it too, with a second line', async () => {
    const s = await setup('in_progress');
    const res = await putAddress(s.admin, s.id, { ...ADDRESS, line2: 'Apt 4' });
    expect(res.status).toBe(200);
    expect(res.body.data.address.line2).toBe('Apt 4');
  });

  it('refuses an address the carrier cannot confirm, with its reasons', async () => {
    const s = await setup();
    shipping.settings.invalidAddress = ['Address not found'];

    const res = await putAddress(s.client, s.id);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'ADDRESS_NOT_DELIVERABLE',
      details: { messages: ['Address not found'] },
    });
    expect(await shipmentRow(s.id)).toBeUndefined();
  });

  it.each([
    ['a missing name', { name: ' ' }],
    ['a state outside the US', { state: 'ON' }],
    ['a short ZIP code', { postalCode: '941' }],
    ['a long first line', { line1: 'x'.repeat(101) }],
  ])('rejects %s', async (_label, change) => {
    const s = await setup();
    const res = await putAddress(s.client, s.id, { ...ADDRESS, ...change });
    expect(res.status).toBe(400);
    expect(shipping.calls.checkAddress).toHaveLength(0);
  });

  it('needs a login, and keeps other clients out', async () => {
    const s = await setup();
    const other = await loggedInAgent(app);
    expect((await putAddress(request(app), s.id)).status).toBe(401);
    expect((await putAddress(other.agent, s.id)).status).toBe(403);
  });

  it('refuses digital work, and commissions before the deposit or after the final payment', async () => {
    const digital = await setup('in_progress', { fulfillmentType: 'digital' });
    const quoted = await setup('quoted');
    const shipped = await setup('ready_to_ship');

    expect((await putAddress(digital.client, digital.id)).body.error.code).toBe('DOES_NOT_SHIP');
    for (const s of [quoted, shipped]) {
      const res = await putAddress(s.client, s.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SHIPPING_CLOSED');
    }
  });

  it('answers 503 while shipping is off, and 502 when the carrier is down', async () => {
    const s = await setup();
    const off = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
    const { agent } = await loggedInAgent(off);
    const owner = await createQuotedCommission({
      status: 'in_progress',
      fulfillmentType: 'physical',
    });
    expect((await putAddress(agent, owner.id)).status).toBe(503);

    shipping.settings.failNext = { method: 'checkAddress', status: 500 };
    const res = await putAddress(s.client, s.id);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('SHIPPING_PROVIDER_ERROR');
  });

  it('refuses the address if the commission moved on while it was being checked', async () => {
    const s = await setup('awaiting_final_payment');
    shipping.setup.provider.checkAddress = (async (address) => {
      await pool.query(`UPDATE commissions SET status = 'ready_to_ship' WHERE id = $1`, [s.id]);
      return { valid: true, messages: [], address };
    }) as typeof shipping.setup.provider.checkAddress;

    const res = await putAddress(s.client, s.id);
    expect(res.status).toBe(409);
    expect(await shipmentRow(s.id)).toBeUndefined();
  });
});

describe('PUT /admin/commissions/:id/shipping/package', () => {
  it('stores the weight and size', async () => {
    const s = await setup('in_progress');

    const res = await putPackage(s.admin, s.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      address: null,
      addressRemovedAt: null,
      package: PACKAGE,
      chosen: null,
    });
  });

  it.each([
    ['no weight', { weightOz: 0 }],
    ['over 70 lb', { weightOz: 1121 }],
    ['a side over 108 inches', { lengthIn: 109 }],
    ['three decimals', { heightIn: 0.125 }],
    ['text', { widthIn: '14' }],
  ])('rejects %s', async (_label, change) => {
    const s = await setup('in_progress');
    expect((await putPackage(s.admin, s.id, { ...PACKAGE, ...change })).status).toBe(400);
  });

  it('is for the admin only', async () => {
    const s = await setup('in_progress');
    expect((await putPackage(request(app), s.id)).status).toBe(401);
    expect((await putPackage(s.client, s.id)).status).toBe(403);
  });

  it('refuses work that does not ship, or is past the final payment', async () => {
    const digital = await setup('in_progress', { fulfillmentType: 'digital' });
    const paid = await setup('ready_to_ship');
    expect((await putPackage(digital.admin, digital.id)).body.error.code).toBe('DOES_NOT_SHIP');
    expect((await putPackage(paid.admin, paid.id)).body.error.code).toBe('SHIPPING_CLOSED');
  });

  it('answers 503 while shipping is off', async () => {
    const s = await setup('in_progress');
    const off = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
    const { agent } = await loggedInAgent(off, { role: 'admin' });
    expect((await putPackage(agent, s.id)).status).toBe(503);
  });
});

describe('POST /commissions/:id/shipping/options', () => {
  it('offers the USPS services only, cheapest first, with the packaging fee added', async () => {
    const s = await setup();

    const options = await readyToChoose(s);

    expect(options).toEqual([
      {
        rateId: 'rate_1_usps_ground_advantage',
        carrier: 'USPS',
        serviceName: 'Ground Advantage',
        estimatedDays: 4,
        postageCents: 758,
        packagingFeeCents: TEST_PACKAGING_FEE_CENTS,
        totalCents: 758 + TEST_PACKAGING_FEE_CENTS,
      },
      {
        rateId: 'rate_1_usps_priority',
        carrier: 'USPS',
        serviceName: 'Priority Mail',
        estimatedDays: 2,
        postageCents: 1210,
        packagingFeeCents: TEST_PACKAGING_FEE_CENTS,
        totalCents: 1210 + TEST_PACKAGING_FEE_CENTS,
      },
    ]);
    expect(shipping.calls.quote[0]).toEqual({
      from: TEST_FROM,
      to: {
        name: 'Ana Client',
        street1: '215 CLAYTON ST',
        street2: null,
        city: 'SAN FRANCISCO',
        state: 'CA',
        zip: '94117-0001',
      },
      parcel: PACKAGE,
    });
    expect((await shipmentRow(s.id)).provider_shipment_id).toBe('shp_1');
  });

  it('waits for the address, then the package', async () => {
    const s = await setup();
    const none = await getOptions(s.client, s.id);
    expect(none.status).toBe(409);
    expect(none.body.error).toMatchObject({
      code: 'SHIPPING_INCOMPLETE',
      details: { missing: ['address', 'package'] },
    });

    await putAddress(s.client, s.id);
    const noPackage = await getOptions(s.client, s.id);
    expect(noPackage.body.error.details.missing).toEqual(['package']);
    expect(noPackage.body.error.message).toMatch(/package details/);

    await pool.query('DELETE FROM shipments');
    await putPackage(s.admin, s.id);
    const noAddress = await getOptions(s.client, s.id);
    expect(noAddress.body.error).toMatchObject({
      details: { missing: ['address'] },
      message: 'Enter the shipping address first',
    });
  });

  it('is only open while the final payment is due', async () => {
    const s = await setup('in_progress');
    const res = await getOptions(s.client, s.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIPPING_CLOSED');
  });

  it('says so when no offered service can take the package', async () => {
    const s = await setup();
    shipping.settings.services = [['usps_media_mail', 'Media Mail', 400, 8]];
    await putAddress(s.client, s.id);
    await putPackage(s.admin, s.id);

    const res = await getOptions(s.client, s.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_SHIPPING_OPTIONS');
  });

  it('throws the prices away if the address changed meanwhile', async () => {
    const s = await setup();
    await putAddress(s.client, s.id);
    await putPackage(s.admin, s.id);
    shipping.settings.duringQuote = async () => {
      await pool.query(`UPDATE shipments SET city = 'OAKLAND' WHERE commission_id = $1`, [s.id]);
    };

    const res = await getOptions(s.client, s.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIPPING_CHANGED');
    expect((await shipmentRow(s.id)).provider_shipment_id).toBeNull();
  });

  it('needs a login, keeps other clients out, and reports a carrier outage', async () => {
    const s = await setup();
    const other = await loggedInAgent(app);
    expect((await getOptions(request(app), s.id)).status).toBe(401);
    expect((await getOptions(other.agent, s.id)).status).toBe(403);

    await putAddress(s.client, s.id);
    await putPackage(s.admin, s.id);
    shipping.settings.failNext = { method: 'quote', status: null };
    expect((await getOptions(s.client, s.id)).status).toBe(502);
  });
});

describe('PUT /commissions/:id/shipping/choice', () => {
  it('records the option, priced by the carrier, and shows it', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);

    const res = await choose(s.client, s.id, ground!.rateId);

    expect(res.status).toBe(200);
    expect(res.body.data.chosen).toEqual({
      carrier: 'USPS',
      serviceName: 'Ground Advantage',
      estimatedDays: 4,
      postageCents: 758,
      packagingFeeCents: TEST_PACKAGING_FEE_CENTS,
      totalCents: 758 + TEST_PACKAGING_FEE_CENTS,
    });
    expect(shipping.calls.getRate).toEqual([ground!.rateId]);
    expect((await getShipping(s.client, s.id)).body.data.chosen.postageCents).toBe(758);
  });

  it('forgets the choice when the address or package changes', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);
    await choose(s.client, s.id, ground!.rateId);

    await putPackage(s.admin, s.id, { ...PACKAGE, weightOz: 20 });
    expect((await getShipping(s.client, s.id)).body.data.chosen).toBeNull();

    await getOptions(s.client, s.id);
    const [again] = (await getOptions(s.client, s.id)).body.data;
    await choose(s.client, s.id, again.rateId);
    await putAddress(s.client, s.id, { ...ADDRESS, city: 'Oakland' });
    expect((await getShipping(s.client, s.id)).body.data.chosen).toBeNull();
  });

  it('refuses an option from an earlier quote, or one the carrier does not know', async () => {
    const s = await setup();
    const [first] = await readyToChoose(s);
    await getOptions(s.client, s.id); // a newer quote

    for (const rateId of [first!.rateId, 'rate_made_up']) {
      const res = await choose(s.client, s.id, rateId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SHIPPING_OPTION_STALE');
    }
    expect((await shipmentRow(s.id)).rate_id).toBeNull();
  });

  it("refuses a service that isn't offered, even from the same quote", async () => {
    const s = await setup();
    await readyToChoose(s);

    const res = await choose(s.client, s.id, 'rate_1_usps_media_mail');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SHIPPING_OPTION_NOT_OFFERED');
  });

  it('validates, needs a login, keeps other clients out, and reports a carrier outage', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);
    const other = await loggedInAgent(app);

    expect((await choose(s.client, s.id, '')).status).toBe(400);
    expect((await choose(request(app), s.id, ground!.rateId)).status).toBe(401);
    expect((await choose(other.agent, s.id, ground!.rateId)).status).toBe(403);
    shipping.settings.failNext = { method: 'getRate', status: 500 };
    expect((await choose(s.client, s.id, ground!.rateId)).status).toBe(502);
  });

  it('is only open while the final payment is due', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);
    await pool.query(`UPDATE commissions SET status = 'ready_to_ship' WHERE id = $1`, [s.id]);
    expect((await choose(s.client, s.id, ground!.rateId)).body.error.code).toBe('SHIPPING_CLOSED');
  });
});

describe('the final payment of a physical commission', () => {
  it('adds the chosen shipping as its own line, records it, and goes to ready_to_ship', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);
    await choose(s.client, s.id, ground!.rateId);
    const shippingCents = 758 + TEST_PACKAGING_FEE_CENTS;

    const started = await payFinal(s.client, s.id);

    expect(started.status).toBe(201);
    expect(stripe.calls.checkout[0]!.request).toMatchObject({
      type: 'final',
      amountCents: 5000 + shippingCents,
      lines: [
        { name: `Balance for commission #${s.id}`, amountCents: 5000 },
        {
          name: 'Shipping & packaging (USPS Ground Advantage)',
          amountCents: shippingCents,
        },
      ],
    });
    const { rows } = await pool.query(
      'SELECT amount_cents, shipping_cents FROM payments WHERE commission_id = $1',
      [s.id],
    );
    expect(rows).toEqual([{ amount_cents: 5000 + shippingCents, shipping_cents: shippingCents }]);

    const sessionId = (started.body.data.url as string).split('/').pop()!;
    await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 5000 + shippingCents }));
    const status = await pool.query('SELECT status FROM commissions WHERE id = $1', [s.id]);
    expect(status.rows[0].status).toBe('ready_to_ship');
    const payments = await s.client.get(`/api/v1/commissions/${s.id}/payments`);
    expect(payments.body.data[0]).toMatchObject({ status: 'succeeded', shippingCents });
  });

  it('reuses an open page for the same total, and replaces it when the option changes', async () => {
    const s = await setup();
    const [ground, priority] = await readyToChoose(s);
    await choose(s.client, s.id, ground!.rateId);

    const first = await payFinal(s.client, s.id);
    const again = await payFinal(s.client, s.id);
    expect(again.status).toBe(200);
    expect(again.body.data.url).toBe(first.body.data.url);

    await choose(s.client, s.id, priority!.rateId);
    const changed = await payFinal(s.client, s.id);

    expect(changed.status).toBe(201);
    expect(changed.body.data.url).not.toBe(first.body.data.url);
    expect(stripe.calls.expired).toEqual([first.body.data.url.split('/').pop()]);
    const { rows } = await pool.query(
      'SELECT status, amount_cents FROM payments WHERE commission_id = $1 ORDER BY id',
      [s.id],
    );
    expect(rows).toEqual([
      { status: 'expired', amount_cents: 5000 + 758 + TEST_PACKAGING_FEE_CENTS },
      { status: 'pending', amount_cents: 5000 + 1210 + TEST_PACKAGING_FEE_CENTS },
    ]);
  });

  it('needs a shipping option first', async () => {
    const s = await setup();
    await readyToChoose(s);

    const res = await payFinal(s.client, s.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SHIPPING_NOT_CHOSEN');
    expect(stripe.calls.checkout).toHaveLength(0);
  });

  it('asks to choose again if the postage changed, or the option expired', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);
    await choose(s.client, s.id, ground!.rateId);

    shipping.settings.priceChange = 25;
    const changed = await payFinal(s.client, s.id);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('SHIPPING_PRICE_CHANGED');

    shipping.settings.priceChange = 0;
    shipping.settings.failNext = { method: 'getRate', status: 404 };
    expect((await payFinal(s.client, s.id)).body.error.code).toBe('SHIPPING_PRICE_CHANGED');
    shipping.settings.failNext = { method: 'getRate', status: 503 };
    expect((await payFinal(s.client, s.id)).status).toBe(502);
    expect(stripe.calls.checkout).toHaveLength(0);
  });

  it('cannot be paid while shipping is off', async () => {
    const off = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
    const { agent, user } = await loggedInAgent(off);
    const commission = await createQuotedCommission({
      clientId: user.id,
      status: 'awaiting_final_payment',
      fulfillmentType: 'physical',
    });

    const res = await payFinal(agent, commission.id);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SHIPPING_UNAVAILABLE');
  });

  it('adds nothing for mixed-media work', async () => {
    const s = await setup('awaiting_final_payment', { fulfillmentType: 'mixed_media' });
    await payFinal(s.client, s.id);
    expect(stripe.calls.checkout[0]!.request.amountCents).toBe(5000);
    expect(stripe.calls.checkout[0]!.request.lines).toBeUndefined();
    expect(shipping.calls.getRate).toHaveLength(0);
  });
});

describe('the client’s account', () => {
  it('includes the shipment in the data download', async () => {
    const s = await setup();
    await putAddress(s.client, s.id);

    const res = await s.client.get('/api/v1/users/me/export');
    expect(res.body.data.commissions[0].shipment.address.city).toBe('SAN FRANCISCO');
  });

  it('removes the name and street on deletion, and keeps the city, state, and ZIP', async () => {
    const s = await setup();
    const [ground] = await readyToChoose(s);
    await choose(s.client, s.id, ground!.rateId);
    await pool.query(`UPDATE commissions SET status = 'completed' WHERE id = $1`, [s.id]);
    const untouched = await createQuotedCommission({
      clientId: (await createUser()).id,
      status: 'in_progress',
      fulfillmentType: 'physical',
    });
    await putAddress(s.admin, untouched.id);

    const res = await s.client
      .delete('/api/v1/users/me')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: s.user.password });
    expect(res.status).toBe(204);

    const row = await shipmentRow(s.id);
    expect(row).toMatchObject({
      recipient_name: null,
      address_line1: null,
      address_line2: null,
      city: 'SAN FRANCISCO',
      state: 'CA',
      postal_code: '94117-0001',
      rate_id: ground!.rateId,
    });
    expect(row.address_removed_at).toBeInstanceOf(Date);
    const admin = await getShipping(s.admin, s.id);
    expect(admin.body.data).toMatchObject({ address: null, addressRemovedAt: expect.any(String) });
    expect((await shipmentRow(untouched.id)).recipient_name).toBe('Ana Client');
  });
});

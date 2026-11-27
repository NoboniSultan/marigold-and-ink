/** Labels, tracking, and the tracking webhook (milestone 11b), with fake Shippo and email. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createQuotedCommission,
  createShipment,
  createShippingLabel,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';
import { fakeEmail } from '../../../../tests/helpers/email.ts';
import { fakeShipping, TEST_WEBHOOK_TOKEN } from '../../../../tests/helpers/shipping.ts';
import type { TrackingInfo } from '../../../adapters/shippo.ts';

// The fake quotes Priority 1,210, Ground Advantage 758, Media Mail 400, UPS Ground 900;
// USPS Ground Advantage and Priority are offered, cheapest first.
type Agent = ReturnType<typeof request.agent>;

let shipping: ReturnType<typeof fakeShipping>;
let email: ReturnType<typeof fakeEmail>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  shipping = fakeShipping();
  email = fakeEmail();
  app = createApp({
    adapters: { email: email.sender, google: null, payments: null, shipping: shipping.setup },
  });
});

/** What the client chose and paid for (the quote it came from is long gone). */
const PAID_CHOICE = {
  providerShipmentId: 'shp_paid',
  rateId: 'rate_paid',
  carrier: 'USPS',
  serviceToken: 'usps_ground_advantage',
  serviceName: 'Ground Advantage',
  postageCents: 700,
  packagingFeeCents: 333,
  rateChosenAt: new Date(),
};

/** A client's physical commission at `status` with its address, package, and paid choice. */
async function setup(status = 'ready_to_ship', overrides: Record<string, unknown> = {}) {
  const client = await loggedInAgent(app);
  const admin = await loggedInAgent(app, { role: 'admin' });
  const commission = await createQuotedCommission({
    clientId: client.user.id,
    status,
    fulfillmentType: 'physical',
    ...overrides,
  });
  const shipment = await createShipment({ commissionId: commission.id, ...PAID_CHOICE });
  return {
    client: client.agent,
    clientEmail: client.user.email as string,
    adminEmail: admin.user.email as string,
    admin: admin.agent,
    id: commission.id as number,
    shipmentId: shipment.id as number,
  };
}

const adminBase = (id: number) => `/api/v1/admin/commissions/${id}/shipping`;
const labelOptions = (agent: Agent | ReturnType<typeof request>, id: number) =>
  agent.post(`${adminBase(id)}/label-options`).set('Origin', TRUSTED_ORIGIN);
const buy = (agent: Agent | ReturnType<typeof request>, id: number, rateId: unknown) =>
  agent
    .post(`${adminBase(id)}/label`)
    .set('Origin', TRUSTED_ORIGIN)
    .send({ rateId });
const voidLabel = (agent: Agent | ReturnType<typeof request>, id: number) =>
  agent.post(`${adminBase(id)}/label/void`).set('Origin', TRUSTED_ORIGIN);
const refresh = (agent: Agent | ReturnType<typeof request>, id: number) =>
  agent.post(`${adminBase(id)}/tracking/refresh`).set('Origin', TRUSTED_ORIGIN);
const webhook = (body: object, token: string | null = TEST_WEBHOOK_TOKEN) =>
  request(app)
    .post(`/api/v1/webhooks/shippo${token === null ? '' : `?token=${token}`}`)
    .send(body);
const trackUpdated = (trackingNumber: string, status = 'DELIVERED') => ({
  event: 'track_updated',
  test: true,
  // What a webhook says is never used: tracking is read back from Shippo.
  data: { carrier: 'usps', tracking_number: trackingNumber, tracking_status: { status } },
});

/** Prices fetched and the client's service bought; returns the tracking number. */
async function bought(s: Awaited<ReturnType<typeof setup>>) {
  const options = await labelOptions(s.admin, s.id);
  expect(options.status).toBe(200);
  const res = await buy(s.admin, s.id, options.body.data[0].rateId);
  expect(res.status).toBe(200);
  return res.body.data.label.trackingNumber as string;
}

function tracking(
  status: TrackingInfo['status'],
  scans: TrackingInfo['scans'] = [],
  details: string | null = null,
): TrackingInfo {
  return { status, details, updatedAt: new Date('2026-12-01T10:00:00Z'), eta: null, scans };
}

const scan = (id: string, status: TrackingInfo['status'], at: string) => ({
  id,
  status,
  details: `${status} scan`,
  occurredAt: new Date(at),
  city: 'Kearny',
  state: 'NJ',
});

async function commissionStatus(id: number) {
  const { rows } = await pool.query('SELECT status FROM commissions WHERE id = $1', [id]);
  return rows[0].status as string;
}

async function events(id: number) {
  const { rows } = await pool.query(
    `SELECT from_status, to_status, actor_type, reason FROM commission_events
      WHERE commission_id = $1 ORDER BY id`,
    [id],
  );
  return rows;
}

describe('POST /admin/commissions/:id/shipping/label-options', () => {
  it("prices the package again, marking the client's service with what they paid", async () => {
    const s = await setup();

    const res = await labelOptions(s.admin, s.id);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        rateId: 'rate_1_usps_ground_advantage',
        carrier: 'USPS',
        serviceName: 'Ground Advantage',
        estimatedDays: 4,
        postageCents: 758,
        paidPostageCents: 700,
        matchesChoice: true,
      },
      {
        rateId: 'rate_1_usps_priority',
        carrier: 'USPS',
        serviceName: 'Priority Mail',
        estimatedDays: 2,
        postageCents: 1210,
        paidPostageCents: null,
        matchesChoice: false,
      },
    ]);
    expect(shipping.calls.quote[0]!.to).toMatchObject({ street1: '1 Main St', zip: '10001' });
    const { rows } = await pool.query('SELECT label_quote_id FROM shipments WHERE id = $1', [
      s.shipmentId,
    ]);
    expect(rows[0].label_quote_id).toBe('shp_1');
  });

  it('needs a login, and is admin only', async () => {
    const s = await setup();
    expect((await labelOptions(request(app), s.id)).status).toBe(401);
    expect((await labelOptions(s.client, s.id)).status).toBe(403);
  });

  it('is only open after the final payment, before it ships', async () => {
    for (const status of ['awaiting_final_payment', 'shipped']) {
      const s = await setup(status);
      const res = await labelOptions(s.admin, s.id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LABEL_CLOSED');
    }
  });

  it('refuses work delivered as files', async () => {
    const s = await setup('ready_to_ship', { fulfillmentType: 'mixed_media' });
    expect((await labelOptions(s.admin, s.id)).body.error.code).toBe('DOES_NOT_SHIP');
  });

  it('refuses while a label is in use', async () => {
    const s = await setup();
    await bought(s);
    const res = await labelOptions(s.admin, s.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LABEL_EXISTS');
  });

  it('needs the address (it may have been removed with the account)', async () => {
    const s = await setup();
    await pool.query(
      `UPDATE shipments SET recipient_name = NULL, address_line1 = NULL,
              address_removed_at = now() WHERE id = $1`,
      [s.shipmentId],
    );
    const res = await labelOptions(s.admin, s.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'SHIPPING_INCOMPLETE',
      details: { missing: ['address'] },
    });
  });

  it('answers 502 when Shippo fails, and 503 when shipping is off', async () => {
    const s = await setup();
    shipping.settings.failNext = { method: 'quote', status: 500 };
    expect((await labelOptions(s.admin, s.id)).body.error.code).toBe('SHIPPING_PROVIDER_ERROR');

    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    const { agent } = await loggedInAgent(off, { role: 'admin' });
    expect((await labelOptions(agent, s.id)).status).toBe(503);
  });

  it('says when no service is offered', async () => {
    const s = await setup();
    shipping.settings.services = [['usps_media_mail', 'Media Mail', 400, 8]];
    expect((await labelOptions(s.admin, s.id)).body.error.code).toBe('NO_SHIPPING_OPTIONS');
  });
});

describe('POST /admin/commissions/:id/shipping/label', () => {
  it('buys the label as a letter-size PDF and shows its tracking', async () => {
    const s = await setup();
    const options = await labelOptions(s.admin, s.id);

    const res = await buy(s.admin, s.id, options.body.data[0].rateId);

    expect(res.status).toBe(200);
    expect(shipping.calls.buyLabel).toEqual([
      { rateId: 'rate_1_usps_ground_advantage', note: `Commission #${s.id}` },
    ]);
    expect(res.body.data.label).toMatchObject({
      carrier: 'USPS',
      serviceName: 'Ground Advantage',
      trackingNumber: '9400TEST1',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400TEST1',
      trackingStatus: 'unknown',
      events: [],
      postageCents: 758, // today's price, paid by the studio
      voidable: true,
    });
    expect(res.body.meta.labelOpen).toBe(false);
    const { rows } = await pool.query('SELECT label_quote_id FROM shipments WHERE id = $1', [
      s.shipmentId,
    ]);
    expect(rows[0].label_quote_id).toBeNull(); // used up
  });

  it('can buy a different service than the client chose', async () => {
    const s = await setup();
    const options = await labelOptions(s.admin, s.id);
    const res = await buy(s.admin, s.id, options.body.data[1].rateId);
    expect(res.body.data.label.serviceName).toBe('Priority Mail');
  });

  it('validates the rate ID', async () => {
    const s = await setup();
    expect((await buy(s.admin, s.id, '')).status).toBe(400);
    expect((await buy(s.admin, s.id, 'x'.repeat(101))).status).toBe(400);
  });

  it('needs a login, and is admin only', async () => {
    const s = await setup();
    const rateId = (await labelOptions(s.admin, s.id)).body.data[0].rateId;
    expect((await buy(request(app), s.id, rateId)).status).toBe(401);
    expect((await buy(s.client, s.id, rateId)).status).toBe(403);
    expect(shipping.calls.buyLabel).toEqual([]);
  });

  it("only buys from the latest prices, and never the client's checkout rate", async () => {
    const s = await setup();
    const first = (await labelOptions(s.admin, s.id)).body.data[0].rateId;
    await labelOptions(s.admin, s.id); // newer prices replace those

    for (const rateId of [first, 'rate_paid']) {
      const res = await buy(s.admin, s.id, rateId);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LABEL_OPTION_STALE');
    }
    expect(shipping.calls.buyLabel).toEqual([]);
  });

  it('asks for new prices when Shippo says the rate is too old to buy', async () => {
    const s = await setup();
    const rateId = (await labelOptions(s.admin, s.id)).body.data[0].rateId;
    shipping.settings.failNext = { method: 'buyLabel', status: 400 };
    const res = await buy(s.admin, s.id, rateId);
    expect(res.body.error.code).toBe('LABEL_OPTION_STALE');
    expect((await buy(s.admin, s.id, rateId)).status).toBe(200); // nothing was half-saved
  });

  it("shows the carrier's reasons when it can't make the label", async () => {
    const s = await setup();
    const rateId = (await labelOptions(s.admin, s.id)).body.data[0].rateId;
    shipping.settings.labelFails = ['Address not found'];
    const res = await buy(s.admin, s.id, rateId);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'LABEL_FAILED',
      details: { messages: ['Address not found'] },
    });
  });

  it('answers 502 when Shippo is down, and buys nothing twice', async () => {
    const s = await setup();
    const rateId = (await labelOptions(s.admin, s.id)).body.data[0].rateId;
    shipping.settings.failNext = { method: 'buyLabel', status: 500 };
    expect((await buy(s.admin, s.id, rateId)).status).toBe(502);

    const [one, two] = await Promise.all([buy(s.admin, s.id, rateId), buy(s.admin, s.id, rateId)]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM shipping_labels');
    expect(rows[0].n).toBe(1);
  });

  it("refuses a service that isn't offered, and an ID Shippo doesn't know", async () => {
    const s = await setup();
    await labelOptions(s.admin, s.id);
    expect((await buy(s.admin, s.id, 'rate_1_usps_media_mail')).body.error.code).toBe(
      'SHIPPING_OPTION_NOT_OFFERED',
    );
    expect((await buy(s.admin, s.id, 'rate_made_up')).body.error.code).toBe('LABEL_OPTION_STALE');
  });
});

describe('GET /admin/commissions/:id/shipping/label/file', () => {
  it('sends the admin to a fresh link to the PDF', async () => {
    const s = await setup();
    await bought(s);

    const res = await s.admin.get(`${adminBase(s.id)}/label/file`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://labels.example/txn_1.pdf?Expires=1');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(shipping.calls.labelFileUrl).toEqual(['txn_1']);
  });

  it('answers 404 without a label, and is admin only', async () => {
    const s = await setup();
    expect((await s.admin.get(`${adminBase(s.id)}/label/file`)).body.error.code).toBe(
      'LABEL_NOT_FOUND',
    );
    expect((await request(app).get(`${adminBase(s.id)}/label/file`)).status).toBe(401);
    expect((await s.client.get(`${adminBase(s.id)}/label/file`)).status).toBe(403);
  });
});

describe('POST /admin/commissions/:id/shipping/label/void', () => {
  it('voids the label and asks for the postage back; another can then be bought', async () => {
    const s = await setup();
    await bought(s);

    const res = await voidLabel(s.admin, s.id);

    expect(res.status).toBe(200);
    expect(shipping.calls.requestRefund).toEqual(['txn_1']);
    expect(res.body.data.label).toBeNull();
    expect(res.body.data.voidedLabels).toEqual([
      {
        trackingNumber: '9400TEST1',
        postageCents: 758,
        voidedAt: expect.any(String),
        refundStatus: 'queued',
      },
    ]);
    expect(res.body.meta.labelOpen).toBe(true);
    expect(await bought(s)).toBe('9400TEST2');
  });

  it('refuses once the carrier has scanned the label', async () => {
    const s = await setup();
    const number = await bought(s);
    shipping.settings.tracking.set(number, tracking('transit'));
    await refresh(s.admin, s.id); // now shipped, so voiding is closed
    expect((await voidLabel(s.admin, s.id)).body.error.code).toBe('LABEL_CLOSED');

    const t = await setup();
    await createShippingLabel({ shipmentId: t.shipmentId, trackingStatus: 'returned' });
    expect((await voidLabel(t.admin, t.id)).body.error.code).toBe('LABEL_IN_USE');
  });

  it('answers 404 without a label, and is admin only', async () => {
    const s = await setup();
    expect((await voidLabel(s.admin, s.id)).body.error.code).toBe('LABEL_NOT_FOUND');
    expect((await voidLabel(request(app), s.id)).status).toBe(401);
    expect((await voidLabel(s.client, s.id)).status).toBe(403);
  });

  it('keeps the label when Shippo fails', async () => {
    const s = await setup();
    await bought(s);
    shipping.settings.failNext = { method: 'requestRefund', status: 500 };
    expect((await voidLabel(s.admin, s.id)).status).toBe(502);
    const { rows } = await pool.query('SELECT voided_at FROM shipping_labels');
    expect(rows[0].voided_at).toBeNull();
  });
});

describe('what the client sees', () => {
  it('shows the tracking, never what postage cost or the voided labels', async () => {
    const s = await setup();
    await bought(s);
    await voidLabel(s.admin, s.id);
    const number = await bought(s);
    shipping.settings.tracking.set(
      number,
      tracking('transit', [
        scan('e1', 'pre_transit', '2026-12-01T09:00:00Z'),
        scan('e2', 'transit', '2026-12-02T09:00:00Z'),
      ]),
    );
    await refresh(s.admin, s.id);

    const res = await s.client.get(`/api/v1/commissions/${s.id}/shipping`);

    expect(res.status).toBe(200);
    expect(res.body.data.label).toMatchObject({
      trackingNumber: number,
      trackingStatus: 'transit',
      postageCents: null,
      voidable: false,
      events: [
        { status: 'transit', details: 'transit scan', city: 'Kearny', state: 'NJ' },
        { status: 'pre_transit' },
      ],
    });
    expect(res.body.data.voidedLabels).toEqual([]);
    expect(res.body.meta.labelOpen).toBe(false);
  });
});

describe('tracking', () => {
  it('moves the commission to shipped at the first scan and emails the client', async () => {
    const s = await setup();
    const number = await bought(s);
    shipping.settings.tracking.set(
      number,
      tracking('transit', [scan('e1', 'transit', '2026-12-02T09:00:00Z')]),
    );

    const res = await refresh(s.admin, s.id);

    expect(res.status).toBe(200);
    expect(shipping.calls.track).toEqual([{ carrier: 'usps', trackingNumber: number }]);
    expect(await commissionStatus(s.id)).toBe('shipped');
    expect((await events(s.id)).at(-1)).toEqual({
      from_status: 'ready_to_ship',
      to_status: 'shipped',
      actor_type: 'system',
      reason: 'The carrier scanned the package',
    });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({ to: s.clientEmail });
    expect(email.sent[0]!.text).toContain(`Tracking number: ${number} (USPS Ground Advantage)`);
    expect(email.sent[0]!.text).toContain(`/commissions/${s.id}`);
  });

  it('changes nothing before the first scan', async () => {
    const s = await setup();
    const number = await bought(s);
    shipping.settings.tracking.set(number, tracking('pre_transit'));
    await refresh(s.admin, s.id);
    expect(await commissionStatus(s.id)).toBe('ready_to_ship');
    expect(email.sent).toEqual([]);
  });

  it('needs a label, a login, and the admin', async () => {
    const s = await setup();
    expect((await refresh(s.admin, s.id)).body.error.code).toBe('LABEL_NOT_FOUND');
    expect((await refresh(request(app), s.id)).status).toBe(401);
    expect((await refresh(s.client, s.id)).status).toBe(403);
  });

  it('answers 502 when Shippo fails', async () => {
    const s = await setup();
    await bought(s);
    shipping.settings.failNext = { method: 'track', status: 500 };
    expect((await refresh(s.admin, s.id)).status).toBe(502);
  });
});

describe('POST /webhooks/shippo', () => {
  it('reads the tracking from Shippo, not the webhook, and moves the commission', async () => {
    const s = await setup();
    const number = await bought(s);
    // The webhook claims delivered; Shippo itself says it's only in transit.
    shipping.settings.tracking.set(number, tracking('transit'));

    const res = await webhook(trackUpdated(number, 'DELIVERED'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { handled: true } });
    expect(await commissionStatus(s.id)).toBe('shipped');
  });

  it('goes through shipped when delivery is the first news, emailing for each', async () => {
    const s = await setup();
    const number = await bought(s);
    shipping.settings.tracking.set(
      number,
      tracking('delivered', [
        scan('e1', 'transit', '2026-12-02T09:00:00Z'),
        scan('e2', 'delivered', '2026-12-03T09:00:00Z'),
      ]),
    );

    await webhook(trackUpdated(number));
    await webhook(trackUpdated(number)); // Shippo's webhooks can repeat

    expect(await commissionStatus(s.id)).toBe('delivered');
    expect((await events(s.id)).slice(-2).map((e) => [e.to_status, e.actor_type])).toEqual([
      ['shipped', 'system'],
      ['delivered', 'system'],
    ]);
    expect(email.sent.map((m) => m.subject)).toEqual([
      expect.stringContaining('shipped'),
      expect.stringContaining('delivered'),
    ]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM tracking_events');
    expect(rows[0].n).toBe(2);
  });

  it('tells the owner once when a package is returned or undeliverable', async () => {
    const s = await setup();
    const number = await bought(s);
    shipping.settings.tracking.set(
      number,
      tracking('returned', [], 'Return to sender: insufficient address'),
    );

    await webhook(trackUpdated(number));
    await webhook(trackUpdated(number));

    expect(await commissionStatus(s.id)).toBe('ready_to_ship');
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      to: s.adminEmail,
      subject: `Delivery problem: commission #${s.id}`,
    });
    expect(email.sent[0]!.text).toContain('is being returned');
    expect(email.sent[0]!.text).toContain('Return to sender: insufficient address');
  });

  it('ignores other events, unknown numbers, and voided labels', async () => {
    const s = await setup();
    const number = await bought(s);
    expect((await webhook({ event: 'transaction_created', data: {} })).body.data.handled).toBe(
      false,
    );
    expect((await webhook(trackUpdated('NOT_OURS'))).body.data.handled).toBe(false);
    expect((await webhook({ event: 'track_updated', data: 'batch' })).body.data.handled).toBe(
      false,
    );
    await voidLabel(s.admin, s.id);
    expect((await webhook(trackUpdated(number))).body.data.handled).toBe(false);
    expect(shipping.calls.track).toEqual([]);
  });

  it('refuses a missing or wrong secret, before reading anything', async () => {
    for (const token of [null, 'wrong', `${TEST_WEBHOOK_TOKEN}x`]) {
      const res = await webhook(trackUpdated('9400TEST1'), token);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('WEBHOOK_TOKEN_INVALID');
    }
    expect((await webhook({ not: 'a webhook' }, 'wrong')).status).toBe(401);
  });

  it('validates the body once the secret is right', async () => {
    expect((await webhook({ data: {} })).status).toBe(400);
  });

  it('answers 404 while the webhook is switched off', async () => {
    const off = createApp({
      adapters: {
        email: null,
        google: null,
        payments: null,
        shipping: { ...shipping.setup, webhookToken: null },
      },
    });
    const res = await request(off)
      .post(`/api/v1/webhooks/shippo?token=${TEST_WEBHOOK_TOKEN}`)
      .send(trackUpdated('x'));
    expect(res.status).toBe(404);
  });

  it('answers 502 when Shippo fails, so Shippo sends it again', async () => {
    const s = await setup();
    const number = await bought(s);
    shipping.settings.failNext = { method: 'track', status: 500 };
    expect((await webhook(trackUpdated(number))).status).toBe(502);
  });
});

describe('marking shipped or delivered by hand', () => {
  it('emails the client as tracking would', async () => {
    const s = await setup();
    await bought(s);

    const res = await s.admin
      .post(`/api/v1/commissions/${s.id}/transitions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ toStatus: 'shipped' });

    expect(res.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe(s.clientEmail);
    expect(email.sent[0]!.text).toContain('Tracking number: 9400TEST1');
  });

  it('still emails without a label, just without tracking', async () => {
    const s = await setup('shipped');
    await s.admin
      .post(`/api/v1/commissions/${s.id}/transitions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ toStatus: 'delivered' });
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.text).not.toContain('Tracking number');
  });

  it('logs a failed email and still answers 200 (the change is saved)', async () => {
    const s = await setup();
    email.failOnce();
    const res = await s.admin
      .post(`/api/v1/commissions/${s.id}/transitions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ toStatus: 'shipped' });
    expect(res.status).toBe(200);
    expect(await commissionStatus(s.id)).toBe('shipped');
  });
});

describe('the daily tracking check', () => {
  it('refreshes packages on their way and pending refunds, and carries on past a failure', async () => {
    const a = await setup();
    const numberA = await bought(a);
    const b = await setup();
    await bought(b);
    await voidLabel(b.admin, b.id); // refund queued
    const numberB = await bought(b);
    shipping.settings.tracking.set(numberA, tracking('transit'));
    shipping.settings.tracking.set(numberB, tracking('delivered'));
    shipping.settings.refundStatus = 'success';
    shipping.settings.failNext = { method: 'track', status: 500 }; // the first label fails

    const result = await app.locals.refreshTracking();

    expect(result).toEqual({ labels: 1, refunds: 1, failed: 1 });
    expect(await commissionStatus(a.id)).toBe('ready_to_ship');
    expect(await commissionStatus(b.id)).toBe('delivered');
    const { rows } = await pool.query(
      'SELECT refund_status FROM shipping_labels WHERE voided_at IS NOT NULL',
    );
    expect(rows[0].refund_status).toBe('success');

    // Delivered packages aren't asked about again.
    shipping.calls.track.length = 0;
    await app.locals.refreshTracking();
    expect(shipping.calls.track).toEqual([{ carrier: 'usps', trackingNumber: numberA }]);
  });

  it('does nothing when shipping is off', async () => {
    const off = createApp({ adapters: { email: null, google: null, payments: null } });
    expect(await off.locals.refreshTracking()).toEqual({ labels: 0, refunds: 0, failed: 0 });
  });

  it('never throws, even when the database fails', async () => {
    const spy = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('db down'));
    await expect(app.locals.refreshTracking()).resolves.toEqual({
      labels: 0,
      refunds: 0,
      failed: 0,
    });
    spy.mockRestore();
  });

  it('keeps going when a refund check fails', async () => {
    const s = await setup();
    await bought(s);
    await voidLabel(s.admin, s.id);
    shipping.settings.failNext = { method: 'getRefund', status: 500 };
    expect(await app.locals.refreshTracking()).toEqual({ labels: 0, refunds: 0, failed: 1 });
  });
});

describe('the data download', () => {
  it("includes the package's tracking, as the client sees it", async () => {
    const s = await setup();
    const number = await bought(s);

    const res = await s.client.get('/api/v1/users/me/export');

    const label = res.body.data.commissions[0].shipment.label;
    expect(label).toMatchObject({ trackingNumber: number, postageCents: null, voidable: false });
  });
});

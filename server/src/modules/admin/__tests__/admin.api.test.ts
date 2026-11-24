/**
 * The admin screens' API (milestone 9): /admin/commissions, /admin/donations, and
 * /admin/reports/monthly. Every route: the happy path, a validation failure, a signed-out
 * visitor (401), and a client (403).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createCommission,
  createDonation,
  createPayment,
  createQuotedCommission,
  createUser,
} from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN, loggedInAgent } from '../../../../tests/helpers/auth.js';
import * as usersService from '../../users/users.service.ts';
import { monthInBusinessZone, todayInBusinessZone } from '../../../lib/businessTime.ts';

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  app = createApp({ adapters: { email: null, google: null, payments: null } });
});

const admin = async () => (await loggedInAgent(app, { role: 'admin' })).agent;
const client = async () => (await loggedInAgent(app)).agent;

/** A fully paid commission's tree donation, as the giving flow leaves it. */
async function treeDonation({
  commissionId,
  trees = 25,
  status = 'owed',
  requestedAt = new Date(),
  payoutDate,
  receiptReference,
  paymentId,
}: {
  paymentId?: number;
  commissionId?: number;
  trees?: number;
  status?: string;
  requestedAt?: Date | null;
  payoutDate?: string;
  receiptReference?: string;
} = {}) {
  const commission = commissionId
    ? { id: commissionId }
    : await createQuotedCommission({ status: 'ready_to_ship', fulfillmentType: 'physical' });
  const finalId =
    paymentId ?? (await createPayment({ commissionId: commission.id, type: 'final' })).id;
  return createDonation({
    commissionId: commission.id,
    paymentId: finalId,
    baseAmountCents: 10000,
    donationAmountCents: trees * 100,
    treeCount: trees,
    status,
    requestedAt: status === 'pending' ? null : requestedAt,
    payoutDate,
    receiptReference,
  });
}

describe('GET /api/v1/admin/commissions', () => {
  it('lists commissions newest first, each with its client', async () => {
    const person = await createUser({ displayName: 'Ana Client', email: 'ana@example.com' });
    const older = await createCommission({ clientId: person.id });
    const newer = await createQuotedCommission({ clientId: person.id });

    const res = await (await admin()).get('/api/v1/admin/commissions');

    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { id: number }) => c.id)).toEqual([newer.id, older.id]);
    expect(res.body.data[0].client).toEqual({
      id: person.id,
      displayName: 'Ana Client',
      email: 'ana@example.com',
    });
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
  });

  it('filters by status, and shows a deleted client as null', async () => {
    const gone = await createUser();
    await createCommission({ clientId: gone.id, status: 'canceled' });
    await createCommission();
    await usersService.anonymize(gone.id);

    const res = await (await admin()).get('/api/v1/admin/commissions?status=canceled');

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].client).toBeNull();
  });

  it('rejects an unknown status (400), a signed-out visitor (401), and a client (403)', async () => {
    expect((await (await admin()).get('/api/v1/admin/commissions?status=lost')).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/commissions')).status).toBe(401);
    expect((await (await client()).get('/api/v1/admin/commissions')).status).toBe(403);
  });
});

describe('GET /api/v1/admin/commissions/:id', () => {
  it('shows the commission with its allowed moves, its client, and its money', async () => {
    const person = await createUser({ displayName: 'Ana Client' });
    const commission = await createQuotedCommission({
      clientId: person.id,
      status: 'ready_to_ship',
      fulfillmentType: 'physical',
    });
    await createPayment({ commissionId: commission.id, type: 'deposit', amountCents: 5000 });
    await treeDonation({ commissionId: commission.id, trees: 25 }); // adds the $50 final

    const res = await (await admin()).get(`/api/v1/admin/commissions/${commission.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.commission).toMatchObject({
      id: commission.id,
      status: 'ready_to_ship',
      availableTransitions: expect.arrayContaining(['shipped']),
    });
    expect(res.body.data.client).toMatchObject({ id: person.id, displayName: 'Ana Client' });
    expect(res.body.data.money).toEqual({
      paidCents: 10000,
      refundedCents: 0,
      withheldForTreesCents: 2500,
      refundableCents: 7500,
      treeMoneyRefundedCents: 0,
      trees: { count: 25, status: 'owed' },
    });
  });

  it('shows tree money given back by a Stripe Dashboard refund', async () => {
    const commission = await createQuotedCommission({
      status: 'ready_to_ship',
      fulfillmentType: 'physical',
    });
    const deposit = await createPayment({ commissionId: commission.id, type: 'deposit' });
    await treeDonation({ commissionId: commission.id, trees: 25 });
    await createPayment({
      commissionId: commission.id,
      type: 'refund',
      amountCents: 10000,
      refundedPaymentId: deposit.id,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeRefundId: 're_dash',
    });

    const res = await (await admin()).get(`/api/v1/admin/commissions/${commission.id}`);

    expect(res.body.data.money).toMatchObject({
      refundedCents: 10000,
      refundableCents: 0,
      treeMoneyRefundedCents: 2500,
    });
  });

  it('has no trees or refundable money for a commission not yet paid', async () => {
    const commission = await createQuotedCommission();
    const res = await (await admin()).get(`/api/v1/admin/commissions/${commission.id}`);
    expect(res.body.data.money).toEqual({
      paidCents: 0,
      refundedCents: 0,
      withheldForTreesCents: 0,
      refundableCents: 0,
      treeMoneyRefundedCents: 0,
      trees: null,
    });
  });

  it('404s an unknown commission, and rejects a bad ID (400), 401, and 403', async () => {
    const agent = await admin();
    expect((await agent.get('/api/v1/admin/commissions/999999')).status).toBe(404);
    expect((await agent.get('/api/v1/admin/commissions/abc')).status).toBe(400);
    const commission = await createCommission();
    expect((await request(app).get(`/api/v1/admin/commissions/${commission.id}`)).status).toBe(401);
    expect((await (await client()).get(`/api/v1/admin/commissions/${commission.id}`)).status).toBe(
      403,
    );
  });
});

describe('GET /api/v1/admin/donations', () => {
  it('lists donations newest first, filtered by status', async () => {
    const owed = await treeDonation({ status: 'owed' });
    await treeDonation({ status: 'paid', payoutDate: '2026-01-15', receiptReference: 'INV-1' });

    const res = await (await admin()).get('/api/v1/admin/donations?status=owed');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: owed.id,
        commissionId: owed.commission_id,
        treeCount: 25,
        amountCents: 2500,
        status: 'owed',
        requestedAt: expect.any(String),
        payoutDate: null,
      }),
    ]);
    expect(res.body.meta.total).toBe(1);

    const paid = await (await admin()).get('/api/v1/admin/donations?status=paid');
    expect(paid.body.data[0]).toMatchObject({
      payoutDate: '2026-01-15',
      receiptReference: 'INV-1',
    });
  });

  it('lists every donation without a filter (an older one with no trees too), and pages past the end', async () => {
    await treeDonation();
    await createDonation(); // not a tree donation: no tree count

    const all = await (await admin()).get('/api/v1/admin/donations');
    expect(all.body.data.map((d: { treeCount: number | null }) => d.treeCount)).toEqual([null, 25]);

    const beyond = await (await admin()).get('/api/v1/admin/donations?page=5');
    expect(beyond.body).toEqual({ data: [], meta: { page: 5, pageSize: 20, total: 2 } });
  });

  it('rejects an unknown status (400), 401, and 403', async () => {
    expect((await (await admin()).get('/api/v1/admin/donations?status=lost')).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/donations')).status).toBe(401);
    expect((await (await client()).get('/api/v1/admin/donations')).status).toBe(403);
  });
});

describe('POST /api/v1/admin/donations/mark-paid', () => {
  const markPaid = (agent: request.Agent | ReturnType<typeof request>, body: object) =>
    agent.post('/api/v1/admin/donations/mark-paid').set('Origin', TRUSTED_ORIGIN).send(body);

  async function statusOf(id: number) {
    const { rows } = await pool.query(
      'SELECT status, payout_date::text AS payout_date, receipt_reference FROM donations WHERE id = $1',
      [id],
    );
    return rows[0];
  }

  it('marks several owed donations paid with one invoice', async () => {
    const first = await treeDonation();
    const second = await treeDonation({ trees: 28 });

    const res = await markPaid(await admin(), {
      donationIds: [second.id, first.id],
      payoutDate: '2026-11-20',
      receiptReference: 'OTP-INV-0042',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { id: number }) => d.id)).toEqual([first.id, second.id]);
    for (const id of [first.id, second.id]) {
      expect(await statusOf(id)).toEqual({
        status: 'paid',
        payout_date: '2026-11-20',
        receipt_reference: 'OTP-INV-0042',
      });
    }
  });

  it('changes nothing unless every donation is owed (409)', async () => {
    const owed = await treeDonation();
    const pending = await treeDonation({ status: 'pending' });

    const res = await markPaid(await admin(), {
      donationIds: [owed.id, pending.id],
      payoutDate: '2026-11-20',
      receiptReference: 'INV',
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'DONATION_NOT_OWED',
      details: { donations: [{ id: pending.id, status: 'pending' }] },
    });
    expect((await statusOf(owed.id)).status).toBe('owed');
  });

  it('404s a donation that does not exist', async () => {
    const owed = await treeDonation();
    const res = await markPaid(await admin(), {
      donationIds: [owed.id, 999999],
      payoutDate: '2026-11-20',
      receiptReference: 'INV',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.details).toEqual({ donationIds: [999999] });
  });

  it('refuses a payout date in the future (422)', async () => {
    const owed = await treeDonation();
    const next = new Date();
    next.setDate(next.getDate() + 3);

    const res = await markPaid(await admin(), {
      donationIds: [owed.id],
      payoutDate: todayInBusinessZone(next),
      receiptReference: 'INV',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PAYOUT_DATE_IN_FUTURE');
  });

  it('validates the body (400), and needs the admin (401, 403)', async () => {
    const agent = await admin();
    expect(
      (await markPaid(agent, { donationIds: [], payoutDate: '2026-11-20', receiptReference: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await markPaid(agent, { donationIds: [1], payoutDate: '20/11/2026', receiptReference: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await markPaid(agent, { donationIds: [1], payoutDate: '2026-11-20', receiptReference: ' ' }))
        .status,
    ).toBe(400);
    const body = { donationIds: [1], payoutDate: '2026-11-20', receiptReference: 'x' };
    expect((await markPaid(request(app), body)).status).toBe(401);
    expect((await markPaid(await client(), body)).status).toBe(403);
  });
});

describe('GET /api/v1/admin/reports/monthly', () => {
  /** Sets a payment's day in New York time (noon, so no time zone moves it). */
  const at = (day: string) => new Date(`${day}T12:00:00-05:00`);

  it('totals each month in New York time', async () => {
    const commission = await createQuotedCommission();
    const deposit = await createPayment({
      commissionId: commission.id,
      type: 'deposit',
      amountCents: 5000,
      createdAt: at('2025-01-10'),
    });
    // 11:30 pm on January 31st in New York is February 1st in UTC: it belongs to January.
    const final = await createPayment({
      commissionId: commission.id,
      type: 'final',
      amountCents: 5000,
      createdAt: new Date('2025-02-01T04:30:00Z'),
    });
    await createPayment({
      commissionId: commission.id,
      type: 'deposit',
      amountCents: 900,
      status: 'expired',
      createdAt: at('2025-01-12'),
    });
    await createPayment({
      commissionId: commission.id,
      type: 'refund',
      amountCents: 2000,
      refundedPaymentId: deposit.id,
      stripeCheckoutSessionId: null,
      stripePaymentIntentId: null,
      stripeRefundId: 're_1',
      createdAt: at('2025-03-05'),
    });
    await treeDonation({
      paymentId: final.id,
      commissionId: commission.id,
      trees: 25,
      requestedAt: at('2025-01-31'),
      status: 'paid',
      payoutDate: '2025-03-02',
      receiptReference: 'INV',
    });

    const res = await (await admin()).get('/api/v1/admin/reports/monthly?year=2025');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(12); // a past year: every month
    expect(res.body.data[0]).toEqual({
      month: '2025-01',
      salesCents: 10000,
      refundsCents: 0,
      netSalesCents: 10000,
      treesOrdered: 25,
      treesOrderedCents: 2500,
      donationsPaidCents: 0,
      donationsOwedAtMonthEndCents: 2500,
    });
    expect(res.body.data[1]).toMatchObject({
      month: '2025-02',
      salesCents: 0,
      donationsOwedAtMonthEndCents: 2500,
    });
    expect(res.body.data[2]).toMatchObject({
      month: '2025-03',
      refundsCents: 2000,
      netSalesCents: -2000,
      donationsPaidCents: 2500,
      donationsOwedAtMonthEndCents: 0,
    });
  });

  it('defaults to this year, and stops at this month', async () => {
    const res = await (await admin()).get('/api/v1/admin/reports/monthly');
    const { year, month } = monthInBusinessZone();

    expect(res.body.data.at(0).month).toBe(`${year}-01`);
    expect(res.body.data.at(-1).month).toBe(month);
  });

  it('rejects a bad year (400), 401, and 403', async () => {
    expect((await (await admin()).get('/api/v1/admin/reports/monthly?year=1999')).status).toBe(400);
    expect((await request(app).get('/api/v1/admin/reports/monthly')).status).toBe(401);
    expect((await (await client()).get('/api/v1/admin/reports/monthly')).status).toBe(403);
  });
});

describe('GET /api/v1/admin/reports/monthly.csv', () => {
  it('downloads the report as CSV', async () => {
    const res = await (await admin()).get('/api/v1/admin/reports/monthly.csv?year=2025');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('marigold-and-ink-report-2025.csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Month,Sales (USD),Refunds (USD),Net sales (USD),Trees ordered,Trees ordered (USD),Donations paid (USD),Donations owed at month end (USD)',
    );
    expect(lines[1]).toBe('2025-01,0.00,0.00,0.00,0,0.00,0.00,0.00');
    expect(lines).toHaveLength(14); // header, 12 months, total
    expect(lines.at(-1)).toMatch(/^Total,/);
  });

  it('needs the admin (401, 403) and a valid year (400)', async () => {
    expect((await request(app).get('/api/v1/admin/reports/monthly.csv')).status).toBe(401);
    expect((await (await client()).get('/api/v1/admin/reports/monthly.csv')).status).toBe(403);
    expect((await (await admin()).get('/api/v1/admin/reports/monthly.csv?year=x')).status).toBe(
      400,
    );
  });
});

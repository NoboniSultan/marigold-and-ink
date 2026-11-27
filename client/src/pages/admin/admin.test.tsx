/** The admin screens (/admin): who may see them, commissions, giving, and the report. */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AdminCommissionDetails,
  AdminCommissionRow,
  AdminDonation,
  MonthlyReportRow,
  Quote,
} from '@shared/types/admin.ts';
import type { Payment } from '@shared/types/payment.ts';
import type { Call, MockResponse } from '../../test/utils.tsx';
import { SIGNED_OUT, USER, mockApi, page, renderRoute } from '../../test/utils.tsx';

const ADMIN = { ...USER, id: 1, role: 'admin' as const, email: 'owner@example.com' };

const COMMISSION = {
  id: 2,
  clientId: USER.id,
  size: 'A3',
  medium: 'ink',
  subjectCount: 1,
  fulfillmentType: 'physical' as const,
  isRush: false,
  notes: 'My cat, Benito',
  status: 'inquiry' as const,
  revisionCount: 0,
  revisionLimit: 2,
  quotedTotalCents: null,
  depositCents: null,
  balanceCents: null,
  createdAt: '2026-11-24T15:00:00.000Z',
  updatedAt: '2026-11-24T15:00:00.000Z',
};

const CLIENT = { id: USER.id, displayName: 'Ana Client', email: 'ana@example.com' };

const NO_MONEY = {
  paidCents: 0,
  refundedCents: 0,
  withheldForTreesCents: 0,
  refundableCents: 0,
  treeMoneyRefundedCents: 0,
  trees: null,
};

const DRAFT: Quote = {
  id: 9,
  commissionId: 2,
  computedAmountCents: 11000,
  adjustedAmountCents: null,
  adjustmentNote: null,
  lineItems: [
    {
      code: 'base',
      label: 'A3 ink portrait',
      quantity: 1,
      unitAmountCents: 10000,
      amountCents: 10000,
    },
    {
      code: 'fulfillment',
      label: 'Shipping',
      quantity: 1,
      unitAmountCents: 1000,
      amountCents: 1000,
    },
  ],
  status: 'draft',
  sentAt: null,
  createdAt: '2026-11-24T15:00:00.000Z',
  updatedAt: '2026-11-24T15:00:00.000Z',
  totalCents: 11000,
  depositCents: 5500,
  balanceCents: 5500,
};

function api({
  user = ADMIN as typeof ADMIN | typeof USER | null,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return user ? { body: { data: user } } : SIGNED_OUT;
    if (call.path === '/auth/providers') {
      return { body: { data: { google: true, emailSignup: true } } };
    }
    return undefined;
  });
}

const details = (overrides: Partial<AdminCommissionDetails> = {}): AdminCommissionDetails => ({
  commission: { ...COMMISSION, availableTransitions: ['canceled'] },
  client: CLIENT,
  money: NO_MONEY,
  ...overrides,
});

describe('Who sees the admin area', () => {
  it('sends a signed-out visitor to log in', async () => {
    api({ user: null });
    const { router } = renderRoute('/admin/commissions');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Fadmin%2Fcommissions');
  });

  it('shows a client "not found", with no Admin link in the header', async () => {
    api({ user: USER });
    renderRoute('/admin');

    expect(await screen.findByRole('heading', { name: /not found/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('gives the admin a header link, and opens on the commissions', async () => {
    api({ extra: (call) => (call.path === '/admin/commissions' ? page([]) : undefined) });
    const { router } = renderRoute('/admin');

    expect(await screen.findByRole('heading', { name: 'Commissions' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/commissions');
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });
});

describe('Admin: commissions', () => {
  it('lists commissions with their clients, and filters by status in the URL', async () => {
    const user = userEvent.setup();
    const rows: AdminCommissionRow[] = [
      { ...COMMISSION, client: CLIENT },
      { ...COMMISSION, id: 1, status: 'canceled', client: null },
    ];
    const calls = api({
      extra: (call) => (call.path === '/admin/commissions' ? page(rows) : undefined),
    });
    const { router } = renderRoute('/admin/commissions');

    expect(await screen.findByRole('link', { name: '#2' })).toHaveAttribute(
      'href',
      '/admin/commissions/2',
    );
    expect(screen.getByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByText('Deleted user')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'inquiry');

    expect(router.state.location.search).toBe('?status=inquiry');
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/admin/commissions' && c.params.get('status') === 'inquiry'),
      ).toBe(true),
    );
  });
});

describe('Admin: one commission', () => {
  it('generates a quote for a new request, then sends it', async () => {
    const user = userEvent.setup();
    let quote: Quote | null = null;
    const calls = api({
      extra: (call) => {
        if (call.path === '/admin/commissions/2') return { body: { data: details() } };
        if (call.path === '/commissions/2/quote' && call.method === 'GET') {
          return quote
            ? { body: { data: quote } }
            : { status: 404, body: { error: { code: 'QUOTE_NOT_FOUND', message: 'No quote' } } };
        }
        if (call.path === '/commissions/2/quote' && call.method === 'POST') {
          quote = DRAFT;
          return { status: 201, body: { data: DRAFT } };
        }
        if (call.path === '/commissions/2/quote/send') {
          quote = { ...DRAFT, status: 'sent', sentAt: '2026-11-24T16:00:00.000Z' };
          return { body: { data: quote } };
        }
        if (call.path === '/commissions/2/payments') {
          return { body: { data: [], meta: { paymentsEnabled: true, currency: 'usd' } } };
        }
        return undefined;
      },
    });
    renderRoute('/admin/commissions/2');

    expect(await screen.findByRole('heading', { name: 'Request #2: Inquiry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ana@example.com' })).toHaveAttribute(
      'href',
      'mailto:ana@example.com',
    );
    await user.click(await screen.findByRole('button', { name: 'Generate quote' }));

    expect(await screen.findByText('A3 ink portrait')).toBeInTheDocument();
    expect(screen.getByText(/Total \(deposit \$55\.00, balance \$55\.00\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send quote to the client' }));

    expect(await screen.findByText(/Sent on Nov 24, 2026/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual([
      '/commissions/2/quote',
      '/commissions/2/quote/send',
    ]);
  });

  it('adjusts a draft in exact cents, and explains a bad amount', async () => {
    const user = userEvent.setup();
    const calls = api({
      extra: (call) => {
        if (call.path === '/admin/commissions/2') return { body: { data: details() } };
        if (call.path === '/commissions/2/quote') return { body: { data: DRAFT } };
        if (call.path === '/commissions/2/payments') {
          return { body: { data: [], meta: { paymentsEnabled: true, currency: 'usd' } } };
        }
        return undefined;
      },
    });
    renderRoute('/admin/commissions/2');

    const amount = await screen.findByLabelText('New total (USD)');
    await user.type(amount, 'lots');
    await user.type(screen.getByLabelText('Reason (the client sees it)'), 'Returning client');
    await user.click(screen.getByRole('button', { name: 'Adjust price' }));
    expect(await screen.findByText(/Enter an amount in dollars/)).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, '99.90');
    await user.click(screen.getByRole('button', { name: 'Adjust price' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        adjustedAmountCents: 9990,
        adjustmentNote: 'Returning client',
      }),
    );
  });

  it('moves the status with an optional note, confirming a cancel', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = api({
      extra: (call) => {
        if (call.path === '/admin/commissions/2') {
          return {
            body: {
              data: details({
                commission: {
                  ...COMMISSION,
                  status: 'deposit_paid',
                  availableTransitions: ['in_progress', 'canceled'],
                },
              }),
            },
          };
        }
        if (call.path === '/commissions/2/quote')
          return { body: { data: { ...DRAFT, status: 'sent' } } };
        if (call.path === '/commissions/2/payments') {
          return { body: { data: [], meta: { paymentsEnabled: true, currency: 'usd' } } };
        }
        if (call.path === '/commissions/2/transitions') return { body: { data: COMMISSION } };
        return undefined;
      },
    });
    renderRoute('/admin/commissions/2');

    await user.type(
      await screen.findByLabelText('Note for the history (optional)'),
      'Starting today',
    );
    await user.click(screen.getByRole('button', { name: 'Move to: In progress' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/commissions/2/transitions')?.body).toEqual({
        toStatus: 'in_progress',
        reason: 'Starting today',
      }),
    );

    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Cancel commission' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Cancel request #2'));
    expect(calls.filter((c) => c.path === '/commissions/2/transitions')).toHaveLength(1);
  });

  it('shows the money, warns about tree money refunded in Stripe, and refunds', async () => {
    const user = userEvent.setup();
    const payments: Payment[] = [
      {
        id: 31,
        type: 'deposit',
        amountCents: 5000,
        shippingCents: 0,
        currency: 'usd',
        status: 'succeeded',
        refundedPaymentId: null,
        createdAt: '2026-11-20T12:00:00.000Z',
        reason: null,
      },
      {
        id: 32,
        type: 'final',
        amountCents: 5000,
        shippingCents: 0,
        currency: 'usd',
        status: 'succeeded',
        refundedPaymentId: null,
        createdAt: '2026-11-22T12:00:00.000Z',
        reason: null,
      },
    ];
    const calls = api({
      extra: (call) => {
        if (call.path === '/admin/commissions/2') {
          return {
            body: {
              data: details({
                commission: { ...COMMISSION, status: 'ready_to_ship', availableTransitions: [] },
                money: {
                  paidCents: 10000,
                  refundedCents: 0,
                  withheldForTreesCents: 2500,
                  refundableCents: 7500,
                  treeMoneyRefundedCents: 500,
                  trees: { count: 25, status: 'owed' },
                },
              }),
            },
          };
        }
        if (call.path === '/commissions/2/quote')
          return { body: { data: { ...DRAFT, status: 'sent' } } };
        if (call.path === '/commissions/2/payments') {
          return { body: { data: payments, meta: { paymentsEnabled: true, currency: 'usd' } } };
        }
        if (call.path === '/admin/commissions/2/refunds') {
          return {
            status: 201,
            body: { data: { ...payments[1], id: 40, type: 'refund', amountCents: 2000 } },
          };
        }
        return undefined;
      },
    });
    renderRoute('/admin/commissions/2');

    expect(await screen.findByText('$25.00 (25 trees, owed)')).toBeInTheDocument();
    expect(screen.getByText('$75.00')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('gave back $5.00 of tree money');

    await user.selectOptions(await screen.findByLabelText('Payment'), '32');
    await user.type(screen.getByLabelText('Amount (USD)'), '20');
    await user.type(screen.getByLabelText('Reason'), 'Frame was scratched');
    await user.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText(/Refund of \$20\.00 started/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/admin/commissions/2/refunds')?.body).toEqual({
      paymentId: 32,
      amountCents: 2000,
      reason: 'Frame was scratched',
    });
  });
});

describe('Admin: giving', () => {
  const owed = (id: number, commissionId: number, trees: number): AdminDonation => ({
    id,
    commissionId,
    treeCount: trees,
    amountCents: trees * 100,
    status: 'owed',
    requestedAt: '2026-11-20T12:00:00.000Z',
    treeRequestId: `req-${id}`,
    payoutDate: null,
    receiptReference: null,
    createdAt: '2026-11-20T12:00:00.000Z',
  });

  it('marks the selected owed donations paid with one invoice', async () => {
    const user = userEvent.setup();
    const rows = [owed(5, 7, 25), owed(6, 9, 28)];
    const calls = api({
      extra: (call) => {
        if (call.path === '/admin/donations') return page(rows);
        if (call.path === '/admin/donations/mark-paid') {
          return { body: { data: rows.map((d) => ({ ...d, status: 'paid' })) } };
        }
        return undefined;
      },
    });
    renderRoute('/admin/giving');

    expect(await screen.findByRole('link', { name: '#7' })).toHaveAttribute(
      'href',
      '/admin/commissions/7',
    );
    const button = screen.getByRole('button', { name: 'Select the donations this invoice covers' });
    expect(button).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    const date = screen.getByLabelText('Paid on');
    await user.clear(date);
    await user.type(date, '2026-11-23');
    await user.type(screen.getByLabelText('Receipt or invoice number'), 'OTP-0042');
    await user.click(screen.getByRole('button', { name: 'Mark 2 paid ($53.00)' }));

    expect(await screen.findByText('Marked 2 donations paid ($53.00).')).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/admin/donations/mark-paid')?.body).toEqual({
      donationIds: [5, 6],
      payoutDate: '2026-11-23',
      receiptReference: 'OTP-0042',
    });
  });

  it('shows why marking paid failed', async () => {
    const user = userEvent.setup();
    api({
      extra: (call) => {
        if (call.path === '/admin/donations') return page([owed(5, 7, 25)]);
        if (call.path === '/admin/donations/mark-paid') {
          return {
            status: 409,
            body: {
              error: {
                code: 'DONATION_NOT_OWED',
                message: 'Only owed donations can be marked paid',
              },
            },
          };
        }
        return undefined;
      },
    });
    renderRoute('/admin/giving');

    await user.click(await screen.findByRole('checkbox', { name: 'Select request #7' }));
    await user.type(screen.getByLabelText('Receipt or invoice number'), 'X');
    await user.click(screen.getByRole('button', { name: 'Mark 1 paid ($25.00)' }));

    expect(await screen.findByText('Only owed donations can be marked paid')).toBeInTheDocument();
  });

  it('lists paid donations with their payout date and receipt', async () => {
    const user = userEvent.setup();
    const calls = api({
      extra: (call) =>
        call.path === '/admin/donations'
          ? page(
              call.params.get('status') === 'paid'
                ? [
                    {
                      ...owed(5, 7, 25),
                      status: 'paid',
                      payoutDate: '2026-11-23',
                      receiptReference: 'OTP-0042',
                    },
                  ]
                : [],
            )
          : undefined,
    });
    renderRoute('/admin/giving');

    expect(await screen.findByText('Nothing owed right now.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Paid' }));

    expect(await screen.findByText('OTP-0042')).toBeInTheDocument();
    expect(screen.getByText('Nov 23, 2026')).toBeInTheDocument();
    expect(calls.some((c) => c.params.get('status') === 'paid')).toBe(true);
  });
});

describe('Admin: monthly report', () => {
  it('shows each month, the year so far, and a CSV download', async () => {
    const rows: MonthlyReportRow[] = [
      {
        month: '2026-10',
        salesCents: 0,
        shippingCents: 0,
        refundsCents: 0,
        shopSalesCents: 0,
        shopRefundsCents: 0,
        netSalesCents: 0,
        treesOrdered: 0,
        treesOrderedCents: 0,
        donationsPaidCents: 0,
        donationsOwedAtMonthEndCents: 0,
      },
      {
        month: '2026-11',
        salesCents: 21000,
        shippingCents: 1234,
        refundsCents: 1000,
        shopSalesCents: 0,
        shopRefundsCents: 0,
        netSalesCents: 20000,
        treesOrdered: 53,
        treesOrderedCents: 5300,
        donationsPaidCents: 2500,
        donationsOwedAtMonthEndCents: 2800,
      },
    ];
    const year = new Date().getFullYear();
    api({
      extra: (call) =>
        call.path === '/admin/reports/monthly' ? { body: { data: rows } } : undefined,
    });
    renderRoute(`/admin/report?year=${year}`);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'November' })).toBeInTheDocument();
    // November's row and the year's total (only November had any).
    expect(within(table).getAllByText('53 ($53.00)')).toHaveLength(2);
    expect(within(table).getAllByText('$12.34')).toHaveLength(2);
    expect(within(table).getByText(`${year} so far`)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      `/api/v1/admin/reports/monthly.csv?year=${year}`,
    );
  });
});

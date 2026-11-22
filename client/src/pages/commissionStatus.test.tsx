/**
 * The commission page: status, price, payments, and paying through Stripe. Stripe itself
 * is never reached: the fake API returns a Checkout URL, and leaving the site is replaced.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommissionDetails, CommissionStatus } from '@shared/types/commission.ts';
import type { Payment, PaymentsMeta } from '@shared/types/payment.ts';
import type { Call, MockResponse } from '../test/utils.tsx';
import { SIGNED_OUT, USER, mockApi, renderRoute } from '../test/utils.tsx';
import { externalNavigation, formatMoney } from './CommissionStatusPage.tsx';

function commission(status: CommissionStatus, overrides: Partial<CommissionDetails> = {}) {
  return {
    id: 12,
    clientId: USER.id,
    size: 'A4',
    medium: 'graphite',
    subjectCount: 1,
    fulfillmentType: 'digital',
    isRush: false,
    notes: null,
    status,
    revisionCount: 0,
    revisionLimit: 2,
    quotedTotalCents: 10000,
    depositCents: 4000,
    balanceCents: 6000,
    createdAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T00:00:00.000Z',
    availableTransitions: [],
    ...overrides,
  } satisfies CommissionDetails;
}

const payment = (overrides: Partial<Payment>): Payment => ({
  id: 1,
  type: 'deposit',
  amountCents: 4000,
  currency: 'usd',
  status: 'succeeded',
  refundedPaymentId: null,
  createdAt: '2026-11-22T10:00:00.000Z',
  ...overrides,
});

function api({
  details = [commission('quoted')] as (CommissionDetails | MockResponse)[],
  payments = [] as Payment[],
  meta = { paymentsEnabled: true, currency: 'usd' } as PaymentsMeta,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  // Each GET of the commission takes the next answer (the last one repeats).
  const answers = [...details];
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return { body: { data: USER } };
    if (call.path === '/commissions/12' && call.method === 'GET') {
      const next = answers.length > 1 ? answers.shift()! : answers[0]!;
      return 'status' in next && typeof next.status === 'number'
        ? (next as MockResponse)
        : { body: { data: next } };
    }
    if (call.path === '/commissions/12/payments') return { body: { data: payments, meta } };
    return undefined;
  });
}

describe('Commission page', () => {
  it('shows the status, details and price, and pays the deposit on Stripe', async () => {
    const go = vi.spyOn(externalNavigation, 'go').mockImplementation(() => {});
    api({
      extra: (call) =>
        call.method === 'POST' && call.path === '/commissions/12/payments/deposit'
          ? {
              status: 201,
              body: {
                data: {
                  url: 'https://checkout.stripe.com/c/pay/cs_test_1',
                  expiresAt: '2026-11-22T11:00:00.000Z',
                  reused: false,
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/commissions/12');

    expect(await screen.findByText('Quoted. The deposit starts the work.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Request #12' })).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument(); // total; deposit and balance too
    expect(screen.getByText('graphite')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pay deposit ($40.00)' }));

    expect(go).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(screen.getByRole('button', { name: /Opening the secure payment page/ })).toBeDisabled();
  });

  it('offers the balance when the final payment is due', async () => {
    api({ details: [commission('awaiting_final_payment')] });
    renderRoute('/commissions/12');

    expect(await screen.findByRole('button', { name: 'Pay balance ($60.00)' })).toBeEnabled();
  });

  it('shows why paying could not start, and lets the client try again', async () => {
    vi.spyOn(externalNavigation, 'go').mockImplementation(() => {});
    api({
      extra: (call) =>
        call.method === 'POST'
          ? {
              status: 502,
              body: {
                error: {
                  code: 'PAYMENT_PROVIDER_ERROR',
                  message: "The payment service couldn't be reached. Please try again.",
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/commissions/12');

    await user.click(await screen.findByRole('button', { name: /Pay deposit/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent("couldn't be reached");
    expect(screen.getByRole('button', { name: /Pay deposit/ })).toBeEnabled();
  });

  it('says online payment opens soon while payments are off', async () => {
    api({ meta: { paymentsEnabled: false, currency: 'usd' } });
    renderRoute('/commissions/12');

    expect(await screen.findByText('Online payment opens soon.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay/ })).toBeNull();
  });

  it('thanks the client once Stripe has confirmed, and lists the payment', async () => {
    api({
      details: [commission('deposit_paid')],
      payments: [
        payment({}),
        payment({ id: 2, type: 'final', status: 'expired' }), // an unpaid page: not shown
        payment({ id: 3, type: 'refund', amountCents: 500, status: 'pending' }),
      ],
    });
    renderRoute('/commissions/12?payment=success');

    expect(await screen.findByText('Thank you, your payment went through.')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Deposit: $40.00 on Nov 22, 2026', 'Refund: $5.00 on Nov 22, 2026 (processing)']);
  });

  it('keeps checking until the webhook has moved the status on', async () => {
    const calls = api({ details: [commission('quoted'), commission('deposit_paid')] });
    renderRoute('/commissions/12?payment=success');

    expect(await screen.findByText(/Confirming your payment with Stripe/)).toBeInTheDocument();
    expect(
      await screen.findByText('Thank you, your payment went through.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/commissions/12').length).toBeGreaterThanOrEqual(2);
  });

  it('says so when the client cancelled on Stripe', async () => {
    api();
    renderRoute('/commissions/12?payment=cancelled');

    expect(await screen.findByText(/Payment cancelled. Nothing was charged/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pay deposit/ })).toBeInTheDocument();
  });

  it("says when the request doesn't exist or isn't theirs", async () => {
    api({
      details: [{ status: 404, body: { error: { code: 'COMMISSION_NOT_FOUND', message: 'x' } } }],
    });
    renderRoute('/commissions/12');

    expect(await screen.findByText(/We couldn't find this request/)).toBeInTheDocument();
  });

  it('rejects a malformed ID without calling the API', async () => {
    const calls = api();
    renderRoute('/commissions/abc');

    expect(await screen.findByText(/We couldn't find this request/)).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/commissions'))).toBe(false);
  });

  it('sends logged-out visitors to log in first', async () => {
    mockApi((call) => (call.path === '/auth/session' ? SIGNED_OUT : undefined));
    const { router } = renderRoute('/commissions/12');

    await screen.findByRole('heading', { name: 'Log in' });
    expect(router.state.location.search).toBe('?next=%2Fcommissions%2F12');
  });
});

describe('formatMoney', () => {
  it('formats cents in the shop currency, or as a plain amount without one', () => {
    expect(formatMoney(123456, 'usd')).toBe('$1,234.56');
    expect(formatMoney(500, null)).toBe('5.00');
  });
});

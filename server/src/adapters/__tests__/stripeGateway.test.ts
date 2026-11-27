import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  createStripeGateway,
  createWebhookParser,
  PaymentGatewayError,
  toPaymentEvent,
  WebhookSignatureError,
} from '../stripe/stripeGateway.ts';
import {
  checkoutCompleted,
  checkoutExpired,
  refundEvent,
  sign,
  TEST_WEBHOOK_SECRET,
} from '../../../tests/helpers/stripe.ts';

const asEvent = (body: object) => body as unknown as Stripe.Event;

describe('toPaymentEvent', () => {
  it('maps a completed Checkout session', () => {
    const event = checkoutCompleted({ sessionId: 'cs_1', amountCents: 4000, eventId: 'evt_1' });

    expect(toPaymentEvent(asEvent(event))).toEqual({
      id: 'evt_1',
      stripeType: 'checkout.session.completed',
      type: 'checkout.completed',
      session: {
        id: 'cs_1',
        paid: true,
        paymentIntentId: 'pi_test_cs_1',
        amountCents: 4000,
        currency: 'usd',
      },
    });
  });

  it('reads an expanded payment intent object as its ID, and an unpaid session as unpaid', () => {
    const event = checkoutCompleted({ sessionId: 'cs_1', amountCents: 4000, paid: false });
    (event.data.object as Record<string, unknown>).payment_intent = { id: 'pi_expanded' };

    const mapped = toPaymentEvent(asEvent(event));

    expect(mapped).toMatchObject({ session: { paid: false, paymentIntentId: 'pi_expanded' } });
  });

  it('maps an expired session', () => {
    expect(toPaymentEvent(asEvent(checkoutExpired('cs_2')))).toMatchObject({
      type: 'checkout.expired',
      session: { id: 'cs_2' },
    });
  });

  it.each([
    ['succeeded', 'succeeded'],
    ['pending', 'pending'],
    ['requires_action', 'pending'],
    ['failed', 'failed'],
    ['canceled', 'failed'],
  ])('maps a refund with Stripe status %s to %s', (stripeStatus, status) => {
    const event = refundEvent({
      refundId: 're_1',
      paymentIntentId: 'pi_1',
      amountCents: 500,
      status: stripeStatus,
      refundPaymentId: 7,
    });

    expect(toPaymentEvent(asEvent(event))).toMatchObject({
      type: 'refund.changed',
      refund: {
        id: 're_1',
        status,
        amountCents: 500,
        currency: 'usd',
        paymentIntentId: 'pi_1',
        refundPaymentId: 7,
      },
    });
  });

  it('ignores refund metadata that is not a row ID', () => {
    const event = refundEvent({ refundId: 're_1', paymentIntentId: 'pi_1', amountCents: 500 });
    (event.data.object as { metadata: object }).metadata = { refund_payment_id: 'abc' };

    expect(toPaymentEvent(asEvent(event))).toMatchObject({ refund: { refundPaymentId: null } });
  });

  it('passes other event types through as ignored', () => {
    const event = { ...checkoutExpired('cs_3'), type: 'customer.created', id: 'evt_9' };

    expect(toPaymentEvent(asEvent(event))).toEqual({
      id: 'evt_9',
      stripeType: 'customer.created',
      type: 'ignored',
    });
  });
});

describe('webhook signature check', () => {
  const parse = createWebhookParser(TEST_WEBHOOK_SECRET);
  const payload = JSON.stringify(checkoutExpired('cs_4'));

  it('accepts a correctly signed body', () => {
    expect(parse(Buffer.from(payload), sign(payload)).type).toBe('checkout.expired');
  });

  it('refuses a missing signature, a wrong secret, and a body changed after signing', () => {
    expect(() => parse(Buffer.from(payload), undefined)).toThrow(WebhookSignatureError);
    expect(() => parse(Buffer.from(payload), sign(payload, 'whsec_someone_else'))).toThrow(
      WebhookSignatureError,
    );
    const tampered = payload.replace('cs_4', 'cs_5');
    expect(() => parse(Buffer.from(tampered), sign(payload))).toThrow(WebhookSignatureError);
  });
});

/**
 * A stand-in for the network: records each request the real SDK builds and answers with
 * the given Stripe-shaped JSON, so the adapter's real requests are checked offline.
 */
function recordingFetch(answers: { status?: number; body: object }[]) {
  const requests: { url: string; method: string; headers: Headers; form: URLSearchParams }[] = [];
  const fetch = (async (url: string | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      form: new URLSearchParams(String(init.body ?? '')),
    });
    const answer = answers.shift()!;
    return new Response(JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json', 'request-id': 'req_test' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const gatewayWith = (fetch: typeof globalThis.fetch) =>
  createStripeGateway({ secretKey: 'sk_test_offline', webhookSecret: TEST_WEBHOOK_SECRET, fetch });

describe('createStripeGateway: requests sent to Stripe', () => {
  const expiresAt = new Date('2026-11-22T12:00:00Z');

  it('creates a card-only Checkout session with metadata and the idempotency key', async () => {
    const { fetch, requests } = recordingFetch([
      {
        body: {
          id: 'cs_test_1',
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/cs_test_1',
          expires_at: expiresAt.getTime() / 1000,
        },
      },
    ]);

    const session = await gatewayWith(fetch).createCheckoutSession(
      {
        paymentId: 7,
        commissionId: 3,
        type: 'deposit',
        amountCents: 4000,
        currency: 'usd',
        description: 'Deposit for commission #3',
        customerEmail: 'client@example.com',
        successUrl: 'https://marigold.test/commissions/3?payment=success',
        cancelUrl: 'https://marigold.test/commissions/3?payment=cancelled',
        expiresAt,
      },
      { idempotencyKey: 'checkout-payment-7' },
    );

    expect(session).toEqual({
      id: 'cs_test_1',
      url: 'https://checkout.stripe.com/c/pay/cs_test_1',
      expiresAt,
    });
    const [sent] = requests;
    expect(sent!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent!.headers.get('idempotency-key')).toBe('checkout-payment-7');
    expect(Object.fromEntries(sent!.form)).toMatchObject({
      mode: 'payment',
      'allowed_payment_method_types[0]': 'card',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '4000',
      'line_items[0][price_data][product_data][name]': 'Deposit for commission #3',
      customer_email: 'client@example.com',
      client_reference_id: '3',
      'metadata[payment_id]': '7',
      'metadata[commission_id]': '3',
      'metadata[type]': 'deposit',
      'payment_intent_data[metadata][payment_id]': '7',
      expires_at: String(expiresAt.getTime() / 1000),
    });
  });

  it('shows each line when there are several (the balance, then shipping)', async () => {
    const { fetch, requests } = recordingFetch([
      { body: { id: 'cs_2', url: 'https://checkout.stripe.com/c/pay/cs_2', expires_at: 1 } },
    ]);

    await gatewayWith(fetch).createCheckoutSession(
      {
        paymentId: 8,
        commissionId: 3,
        type: 'final',
        amountCents: 6158,
        currency: 'usd',
        description: 'Balance for commission #3',
        lines: [
          { name: 'Balance for commission #3', amountCents: 5000 },
          { name: 'Shipping & packaging (USPS Ground Advantage)', amountCents: 1158 },
        ],
        customerEmail: 'client@example.com',
        successUrl: 'https://x',
        cancelUrl: 'https://x',
        expiresAt,
      },
      { idempotencyKey: 'checkout-payment-8' },
    );

    expect(Object.fromEntries(requests[0]!.form)).toMatchObject({
      'line_items[0][price_data][unit_amount]': '5000',
      'line_items[0][price_data][product_data][name]': 'Balance for commission #3',
      'line_items[1][quantity]': '1',
      'line_items[1][price_data][unit_amount]': '1158',
      'line_items[1][price_data][product_data][name]':
        'Shipping & packaging (USPS Ground Advantage)',
    });
  });

  it('refuses a session without a URL', async () => {
    const { fetch } = recordingFetch([{ body: { id: 'cs_1', url: null, expires_at: 1 } }]);

    await expect(
      gatewayWith(fetch).createCheckoutSession(
        {
          paymentId: 1,
          commissionId: 1,
          type: 'final',
          amountCents: 1,
          currency: 'usd',
          description: 'x',
          customerEmail: 'a@b.c',
          successUrl: 'https://x',
          cancelUrl: 'https://x',
          expiresAt,
        },
        { idempotencyKey: 'k' },
      ),
    ).rejects.toThrow(PaymentGatewayError);
  });

  it('creates a refund for a payment intent, with our row in the metadata', async () => {
    const { fetch, requests } = recordingFetch([
      {
        body: {
          id: 're_1',
          object: 'refund',
          amount: 1500,
          currency: 'usd',
          status: 'succeeded',
          payment_intent: 'pi_1',
          metadata: { refund_payment_id: '9', commission_id: '3' },
        },
      },
    ]);

    const result = await gatewayWith(fetch).createRefund(
      { paymentIntentId: 'pi_1', amountCents: 1500, refundPaymentId: 9, commissionId: 3 },
      { idempotencyKey: 'refund-payment-9' },
    );

    expect(result).toEqual({
      id: 're_1',
      status: 'succeeded',
      amountCents: 1500,
      currency: 'usd',
      paymentIntentId: 'pi_1',
      refundPaymentId: 9,
    });
    expect(requests[0]!.url).toBe('https://api.stripe.com/v1/refunds');
    expect(requests[0]!.headers.get('idempotency-key')).toBe('refund-payment-9');
    expect(Object.fromEntries(requests[0]!.form)).toEqual({
      payment_intent: 'pi_1',
      amount: '1500',
      'metadata[commission_id]': '3',
      'metadata[refund_payment_id]': '9',
    });
  });

  it('sends no row ID for an automatic refund', async () => {
    const { fetch, requests } = recordingFetch([
      {
        body: { id: 're_2', amount: 1, currency: 'usd', status: 'pending', payment_intent: 'pi_2' },
      },
    ]);

    await gatewayWith(fetch).createRefund(
      { paymentIntentId: 'pi_2', amountCents: 1, refundPaymentId: null, commissionId: 3 },
      { idempotencyKey: 'auto-refund-cs_1' },
    );

    expect(requests[0]!.form.has('metadata[refund_payment_id]')).toBe(false);
  });

  it("creates a shop order's Checkout page, each item with its quantity", async () => {
    const { fetch, requests } = recordingFetch([
      { body: { id: 'cs_o', url: 'https://checkout.stripe.com/c/pay/cs_o', expires_at: 1 } },
    ]);

    const session = await gatewayWith(fetch).createOrderCheckout(
      {
        orderId: 12,
        currency: 'usd',
        lines: [
          { name: 'Marigold Stickers (Single)', unitAmountCents: 450, quantity: 3 },
          { name: 'Cards (Pack of 5)', unitAmountCents: 1200, quantity: 1 },
        ],
        customerEmail: 'client@example.com',
        successUrl: 'https://marigold.test/orders/12?payment=success',
        cancelUrl: 'https://marigold.test/cart?checkout=cancelled',
        expiresAt,
      },
      { idempotencyKey: 'order-checkout-12' },
    );

    expect(session.id).toBe('cs_o');
    expect(requests[0]!.headers.get('idempotency-key')).toBe('order-checkout-12');
    expect(Object.fromEntries(requests[0]!.form)).toMatchObject({
      mode: 'payment',
      'allowed_payment_method_types[0]': 'card',
      'line_items[0][quantity]': '3',
      'line_items[0][price_data][unit_amount]': '450',
      'line_items[0][price_data][product_data][name]': 'Marigold Stickers (Single)',
      'line_items[1][quantity]': '1',
      'line_items[1][price_data][unit_amount]': '1200',
      client_reference_id: 'order-12',
      'metadata[order_id]': '12',
      'metadata[type]': 'order',
      'payment_intent_data[metadata][order_id]': '12',
      expires_at: String(expiresAt.getTime() / 1000),
    });

    const { fetch: noUrl } = recordingFetch([{ body: { id: 'cs_x', url: null, expires_at: 1 } }]);
    await expect(
      gatewayWith(noUrl).createOrderCheckout(
        {
          orderId: 1,
          currency: 'usd',
          lines: [{ name: 'x', unitAmountCents: 1, quantity: 1 }],
          customerEmail: 'a@b.c',
          successUrl: 'https://x',
          cancelUrl: 'https://x',
          expiresAt,
        },
        { idempotencyKey: 'k' },
      ),
    ).rejects.toThrow(PaymentGatewayError);
  });

  it.each([
    [
      { status: 'complete', payment_status: 'paid', payment_intent: 'pi_9' },
      { status: 'complete', paid: true, paymentIntentId: 'pi_9' },
    ],
    [
      { status: 'expired', payment_status: 'unpaid', payment_intent: null },
      { status: 'expired', paid: false, paymentIntentId: null },
    ],
    [
      { status: 'open', payment_status: 'unpaid' },
      { status: 'open', paid: false, paymentIntentId: null },
    ],
    [
      { status: null, payment_status: 'unpaid' },
      { status: 'open', paid: false, paymentIntentId: null },
    ],
  ])("reads a Checkout page's status from Stripe (%o)", async (body, expected) => {
    const { fetch, requests } = recordingFetch([{ body: { id: 'cs_s', ...body } }]);

    expect(await gatewayWith(fetch).getCheckoutStatus('cs_s')).toEqual(expected);
    expect(requests[0]!.url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_s');
    expect(requests[0]!.method).toBe('GET');
  });

  it('refunds a shop order, naming the order', async () => {
    const { fetch, requests } = recordingFetch([
      {
        body: {
          id: 're_o',
          amount: 800,
          currency: 'usd',
          status: 'succeeded',
          payment_intent: 'pi_o',
        },
      },
    ]);

    await gatewayWith(fetch).createRefund(
      { paymentIntentId: 'pi_o', amountCents: 800, refundPaymentId: null, orderId: 12 },
      { idempotencyKey: 'order-refund-1' },
    );

    expect(Object.fromEntries(requests[0]!.form)).toEqual({
      payment_intent: 'pi_o',
      amount: '800',
      'metadata[order_id]': '12',
    });
  });

  it('expires a session', async () => {
    const { fetch, requests } = recordingFetch([{ body: { id: 'cs_1', status: 'expired' } }]);

    await gatewayWith(fetch).expireCheckoutSession('cs_1');

    expect(requests[0]!.url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1/expire');
    expect(requests[0]!.method).toBe('POST');
  });

  it("turns Stripe's errors into PaymentGatewayError", async () => {
    const { fetch } = recordingFetch([
      {
        status: 400,
        body: { error: { type: 'invalid_request_error', message: 'No such payment_intent' } },
      },
    ]);

    await expect(
      gatewayWith(fetch).createRefund(
        { paymentIntentId: 'pi_x', amountCents: 1, refundPaymentId: 1, commissionId: 1 },
        { idempotencyKey: 'k' },
      ),
    ).rejects.toThrow(/Stripe refund failed: No such payment_intent/);
  });
});

describe('createStripeGateway', () => {
  it('builds without calling Stripe, and verifies with the configured secret', () => {
    const gateway = createStripeGateway({
      secretKey: 'sk_test_unused',
      webhookSecret: TEST_WEBHOOK_SECRET,
    });

    expect(gateway.parseWebhook(Buffer.from(payload()), sign(payload())).id).toBe('evt_fixed');
  });
});

function payload() {
  return JSON.stringify({ ...checkoutExpired('cs_6'), id: 'evt_fixed' });
}

/**
 * Stripe for tests. The network calls are faked (nothing reaches Stripe), but webhook
 * signatures are checked by the real code with a test secret, and the events are built in
 * Stripe's own shape, so the adapter's mapping is exercised too.
 *
 *   const stripe = fakeStripe();
 *   const app = createApp({ adapters: { email: null, google: null, payments: stripe.gateway } });
 *   await postWebhook(app, checkoutCompleted({ sessionId, amountCents: 4000 }));
 */
import Stripe from 'stripe';
import request from 'supertest';
import type { Express } from 'express';
import {
  createWebhookParser,
  PaymentGatewayError,
  type CheckoutRequest,
  type PaymentGateway,
  type RefundInfo,
} from '../../src/adapters/stripe/stripeGateway.ts';

export const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_tests';

export function fakeStripe() {
  const calls = {
    checkout: [] as { request: CheckoutRequest; idempotencyKey: string }[],
    expired: [] as string[],
    refunds: [] as { paymentIntentId: string; amountCents: number; idempotencyKey: string }[],
  };
  const failNext = { checkout: false, refund: false, expire: false };
  let refundStatus: RefundInfo['status'] = 'succeeded';

  const gateway: PaymentGateway = {
    async createCheckoutSession(request, { idempotencyKey }) {
      if (failNext.checkout) {
        failNext.checkout = false;
        throw new PaymentGatewayError('Stripe Checkout session failed: test outage');
      }
      calls.checkout.push({ request, idempotencyKey });
      // Like Stripe, the same idempotency key always gives back the same session.
      const id = `cs_test_${idempotencyKey}`;
      return { id, url: `https://checkout.stripe.com/c/pay/${id}`, expiresAt: request.expiresAt };
    },
    async expireCheckoutSession(sessionId) {
      if (failNext.expire) {
        failNext.expire = false;
        throw new PaymentGatewayError('Stripe session expiry failed: test outage');
      }
      calls.expired.push(sessionId);
    },
    async createRefund(request, { idempotencyKey }) {
      if (failNext.refund) {
        failNext.refund = false;
        throw new PaymentGatewayError('Stripe refund failed: test outage');
      }
      calls.refunds.push({
        paymentIntentId: request.paymentIntentId,
        amountCents: request.amountCents,
        idempotencyKey,
      });
      return {
        id: `re_${idempotencyKey}`,
        status: refundStatus,
        amountCents: request.amountCents,
        currency: 'usd',
        paymentIntentId: request.paymentIntentId,
        refundPaymentId: request.refundPaymentId,
      };
    },
    parseWebhook: createWebhookParser(TEST_WEBHOOK_SECRET),
  };

  return {
    gateway,
    calls,
    /** Makes the next call of that kind fail as if Stripe were down. */
    failNext(kind: keyof typeof failNext) {
      failNext[kind] = true;
    },
    /** Status Stripe reports for new refunds (cards in test mode usually succeed at once). */
    setRefundStatus(status: RefundInfo['status']) {
      refundStatus = status;
    },
  };
}

// --- Stripe-shaped events ---

let counter = 0;

function event(type: string, object: Record<string, unknown>, id?: string) {
  counter += 1;
  return {
    id: id ?? `evt_test_${counter}`,
    object: 'event',
    api_version: '2026-10-28.endive',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  };
}

export function checkoutCompleted({
  sessionId,
  amountCents,
  paymentIntentId = `pi_test_${sessionId}`,
  currency = 'usd',
  paid = true,
  eventId,
}: {
  sessionId: string;
  amountCents: number;
  paymentIntentId?: string;
  currency?: string;
  paid?: boolean;
  eventId?: string;
}) {
  return event(
    'checkout.session.completed',
    {
      id: sessionId,
      object: 'checkout.session',
      mode: 'payment',
      status: 'complete',
      payment_status: paid ? 'paid' : 'unpaid',
      payment_intent: paymentIntentId,
      amount_total: amountCents,
      currency,
      metadata: {},
    },
    eventId,
  );
}

export function checkoutExpired(sessionId: string) {
  return event('checkout.session.expired', {
    id: sessionId,
    object: 'checkout.session',
    status: 'expired',
    payment_status: 'unpaid',
  });
}

export function refundEvent({
  type = 'refund.updated',
  refundId,
  paymentIntentId,
  amountCents,
  status = 'succeeded',
  refundPaymentId,
}: {
  type?: 'refund.created' | 'refund.updated' | 'refund.failed';
  refundId: string;
  paymentIntentId: string;
  amountCents: number;
  status?: string;
  refundPaymentId?: number;
}) {
  return event(type, {
    id: refundId,
    object: 'refund',
    amount: amountCents,
    currency: 'usd',
    payment_intent: paymentIntentId,
    status,
    metadata: refundPaymentId ? { refund_payment_id: String(refundPaymentId) } : {},
  });
}

/** Signs like Stripe does (the SDK's own test helper), with TEST_WEBHOOK_SECRET by default. */
export function sign(payload: string, secret = TEST_WEBHOOK_SECRET) {
  return new Stripe('sk_test_signing_only').webhooks.generateTestHeaderString({ payload, secret });
}

export function postWebhook(
  app: Express,
  body: object,
  { signature }: { signature?: string | null } = {},
) {
  const payload = JSON.stringify(body);
  const req = request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json');
  const header = signature === undefined ? sign(payload) : signature;
  return (header === null ? req : req.set('Stripe-Signature', header)).send(payload);
}

/**
 * The only file that imports the Stripe SDK. Everything else talks to Stripe through the
 * PaymentGateway interface below, in our own small types, so:
 * - the payments module never depends on Stripe's object shapes;
 * - tests replace the network calls with a fake (tests/helpers/fakeStripe.ts) while still
 *   using the real webhook signature check, which is local cryptography, not a network call.
 *
 * Every call that creates something takes an idempotency key: if a request is retried
 * (a timeout, a double click), Stripe returns the original result instead of creating a
 * second Checkout session or refund.
 */
import Stripe from 'stripe';

export type IncomingPaymentType = 'deposit' | 'final';

export interface CheckoutRequest {
  paymentId: number;
  commissionId: number;
  type: IncomingPaymentType;
  amountCents: number;
  currency: string;
  /** Shown on Stripe's page, e.g. "Deposit for commission #12". */
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
}

export interface CheckoutSession {
  id: string;
  url: string;
  expiresAt: Date;
}

/** Our view of a Stripe refund. Stripe's `canceled` counts as failed (no money moved). */
export interface RefundInfo {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  amountCents: number;
  currency: string;
  paymentIntentId: string | null;
  /** The refund row we created for it, if it came from this app. */
  refundPaymentId: number | null;
}

/**
 * The webhook events the app acts on; anything else arrives as `ignored`. Every event keeps
 * Stripe's ID (to skip duplicate deliveries) and Stripe's own type name (for the record).
 */
export type PaymentEvent = { id: string; stripeType: string } & (
  | {
      type: 'checkout.completed';
      session: {
        id: string;
        paid: boolean;
        paymentIntentId: string | null;
        amountCents: number | null;
        currency: string | null;
      };
    }
  | { type: 'checkout.expired'; session: { id: string } }
  | { type: 'refund.changed'; refund: RefundInfo }
  | { type: 'ignored' }
);

export interface PaymentGateway {
  createCheckoutSession(
    request: CheckoutRequest,
    options: { idempotencyKey: string },
  ): Promise<CheckoutSession>;
  /** Closes an open Checkout page so it can't be paid any more. */
  expireCheckoutSession(sessionId: string): Promise<void>;
  createRefund(
    request: {
      paymentIntentId: string;
      amountCents: number;
      refundPaymentId: number | null;
      commissionId: number;
    },
    options: { idempotencyKey: string },
  ): Promise<RefundInfo>;
  /** Checks the signature and returns the event; throws WebhookSignatureError if invalid. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): PaymentEvent;
}

/** The request didn't come from Stripe (missing, wrong, or stale signature). */
export class WebhookSignatureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WebhookSignatureError';
  }
}

/** Stripe refused or failed a request. `message` is Stripe's, safe to log, not to show. */
export class PaymentGatewayError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PaymentGatewayError';
  }
}

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

function toRefundInfo(refund: Stripe.Refund): RefundInfo {
  const rowId = Number(refund.metadata?.refund_payment_id);
  return {
    id: refund.id,
    status:
      refund.status === 'succeeded'
        ? 'succeeded'
        : refund.status === 'failed' || refund.status === 'canceled'
          ? 'failed'
          : 'pending',
    amountCents: refund.amount,
    currency: refund.currency,
    paymentIntentId: idOf(refund.payment_intent),
    refundPaymentId: Number.isSafeInteger(rowId) && rowId > 0 ? rowId : null,
  };
}

/** Maps a verified Stripe event to the few the app handles. Pure, so it's unit-tested. */
export function toPaymentEvent(event: Stripe.Event): PaymentEvent {
  const base = { id: event.id, stripeType: event.type };
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      return {
        ...base,
        type: 'checkout.completed',
        session: {
          id: session.id,
          paid: session.payment_status === 'paid',
          paymentIntentId: idOf(session.payment_intent),
          amountCents: session.amount_total,
          currency: session.currency,
        },
      };
    }
    case 'checkout.session.expired':
      return { ...base, type: 'checkout.expired', session: { id: event.data.object.id } };
    case 'refund.created':
    case 'refund.updated':
    case 'refund.failed':
      return { ...base, type: 'refund.changed', refund: toRefundInfo(event.data.object) };
    default:
      return { ...base, type: 'ignored' };
  }
}

/** Signature check only (no API key or network needed), shared by the real and fake gateways. */
export function createWebhookParser(webhookSecret: string) {
  // The key is never used to call Stripe here: verification is local HMAC checking.
  const stripe = new Stripe('sk_test_signature_check_only');
  return (rawBody: Buffer, signature: string | undefined): PaymentEvent => {
    if (!signature) throw new WebhookSignatureError('Missing Stripe-Signature header');
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      throw new WebhookSignatureError('Invalid Stripe signature', { cause: err });
    }
    return toPaymentEvent(event);
  };
}

async function callStripe<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PaymentGatewayError(`Stripe ${what} failed: ${message}`, { cause: err });
  }
}

export function createStripeGateway({
  secretKey,
  webhookSecret,
}: {
  secretKey: string;
  webhookSecret: string;
}): PaymentGateway {
  // Retries are safe because every create call carries an idempotency key.
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });

  return {
    async createCheckoutSession(request, { idempotencyKey }) {
      const metadata = {
        payment_id: String(request.paymentId),
        commission_id: String(request.commissionId),
        type: request.type,
      };
      const session = await callStripe('Checkout session', () =>
        stripe.checkout.sessions.create(
          {
            mode: 'payment',
            // Cards only for now (a filter on what Stripe would offer): they settle at once,
            // so `checkout.session.completed` means paid. Delayed methods (bank debits)
            // would need the async_payment events.
            allowed_payment_method_types: ['card'],
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: request.currency,
                  unit_amount: request.amountCents,
                  product_data: { name: request.description },
                },
              },
            ],
            customer_email: request.customerEmail,
            client_reference_id: String(request.commissionId),
            metadata,
            payment_intent_data: { metadata },
            success_url: request.successUrl,
            cancel_url: request.cancelUrl,
            expires_at: Math.floor(request.expiresAt.getTime() / 1000),
          },
          { idempotencyKey },
        ),
      );
      if (!session.url) throw new PaymentGatewayError('Stripe returned a session without a URL');
      return { id: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) };
    },

    async expireCheckoutSession(sessionId) {
      await callStripe('session expiry', () => stripe.checkout.sessions.expire(sessionId));
    },

    async createRefund(request, { idempotencyKey }) {
      const refund = await callStripe('refund', () =>
        stripe.refunds.create(
          {
            payment_intent: request.paymentIntentId,
            amount: request.amountCents,
            metadata: {
              commission_id: String(request.commissionId),
              ...(request.refundPaymentId
                ? { refund_payment_id: String(request.refundPaymentId) }
                : {}),
            },
          },
          { idempotencyKey },
        ),
      );
      return toRefundInfo(refund);
    },

    parseWebhook: createWebhookParser(webhookSecret),
  };
}

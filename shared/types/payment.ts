/** Money for commissions: deposits, final payments, and refunds (see docs/decisions/0011). */

export type PaymentType = 'deposit' | 'final' | 'refund';

/** pending: Stripe page open (or refund processing). expired: the page closed unpaid. */
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'expired';

export interface Payment {
  id: number;
  type: PaymentType;
  /** Always positive; `type` says which way the money went. */
  amountCents: number;
  /** Lowercase ISO code, e.g. 'usd'. */
  currency: string;
  status: PaymentStatus;
  /** For refunds: the deposit or final payment refunded. */
  refundedPaymentId: number | null;
  createdAt: string;
  /** Admins only: why a refund was made, and which admin asked (null = automatic). */
  reason?: string | null;
  requestedByUserId?: number | null;
}

export interface PaymentsMeta {
  /** False until Stripe is configured; the site then says online payment opens soon. */
  paymentsEnabled: boolean;
  currency: string | null;
}

export interface PaymentsResponse {
  data: Payment[];
  meta: PaymentsMeta;
}

/** Where to send the client to pay: Stripe's own Checkout page. */
export interface CheckoutStart {
  url: string;
  expiresAt: string;
  /** True when an already-open page was returned instead of a new one. */
  reused: boolean;
}

export interface RefundRequest {
  paymentId: number;
  /** Leave out to refund everything not yet refunded. */
  amountCents?: number;
  reason: string;
}

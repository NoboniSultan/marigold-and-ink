/** Shop orders (milestone 12b, ADR 0020). Money is integer cents. */
import type { ProductPhoto } from './shop.ts';

export type OrderStatus = 'pending_payment' | 'paid' | 'expired' | 'canceled' | 'refunded';

/** One line of a cart, as the browser keeps it: only what was chosen. */
export interface CartLine {
  variantId: number;
  quantity: number;
}

/** A cart line priced by the server (the cart page shows these, never stored prices). */
export interface PricedLine {
  variantId: number;
  productSlug: string;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  lineCents: number;
  /** How many can be bought now (stock), and whether the whole quantity can. */
  available: number;
  ok: boolean;
  photo: ProductPhoto | null;
}

export interface CartPreview {
  lines: PricedLine[];
  /** Variants that no longer exist or aren't for sale; the cart should drop them. */
  unavailable: number[];
  subtotalCents: number;
  currency: string;
  /** True when every line can be bought as it is. */
  ready: boolean;
}

export interface OrderItem {
  variantId: number;
  productName: string;
  variantName: string;
  unitPriceCents: number;
  quantity: number;
  lineCents: number;
}

export interface Order {
  id: number;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  currency: string;
  /** Total refunded so far (succeeded). */
  refundedCents: number;
  /** While payment is pending: the Stripe page to go back to, and when it closes. */
  checkoutUrl: string | null;
  checkoutExpiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface OrderRefund {
  id: number;
  amountCents: number;
  status: 'pending' | 'succeeded' | 'failed';
  reason: string;
  restock: boolean;
  restockedAt: string | null;
  createdAt: string;
}

export interface OrderEvent {
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  actorType: 'client' | 'admin' | 'system';
  reason: string | null;
  createdAt: string;
}

/** The admin's view: who ordered, the history, and the refunds. */
export interface AdminOrder extends Order {
  client: { id: number; displayName: string; email: string } | null;
  events: OrderEvent[];
  refunds: OrderRefund[];
  /** Can it be refunded now (paid, nothing refunded or pending)? */
  refundable: boolean;
}

export interface CheckoutStarted {
  orderId: number;
  url: string;
}

export interface RefundOrderInput {
  reason: string;
  /** Put the items back on sale once the refund succeeds. */
  restock: boolean;
}

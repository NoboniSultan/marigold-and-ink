/** Shop orders (milestone 12b, ADR 0020). Money is integer cents. */
import type { DonationStatus } from './admin.ts';
import type { ProductPhoto } from './shop.ts';
import type { Shipment, ShippingAddress, ShippingAddressInput } from './shipping.ts';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'shipped'
  | 'delivered'
  | 'expired'
  | 'canceled'
  | 'refunded';

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
  /**
   * How it reaches the customer (milestone 12c): shipped, collected locally (any pickup-only
   * item makes the order a pickup), or not yet (an item has no packing details yet).
   */
  delivery: 'ship' | 'pickup' | 'unavailable';
}

/** A shipping option for a cart, priced live for its package and address. */
export interface CartShippingOption {
  serviceToken: string;
  carrier: string;
  serviceName: string;
  estimatedDays: number | null;
  postageCents: number;
  packagingFeeCents: number;
  /** What checkout adds: postage plus packaging. */
  totalCents: number;
}

export interface CartShippingQuote {
  /** The address as the carrier standardized it (send this one to checkout). */
  address: ShippingAddress;
  options: CartShippingOption[];
}

/** Checkout: the cart, and for a shipped order where and how. */
export interface CheckoutInput {
  items: CartLine[];
  shipping?: {
    address: ShippingAddressInput;
    serviceToken: string;
    /** What the customer saw; checkout refuses (409) if the price has changed since. */
    expectedCents: number;
  };
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
  /** Postage and packaging (0 for a pickup). */
  shippingCents: number;
  totalCents: number;
  /** Collected locally instead of shipped. */
  pickup: boolean;
  /** Where it's going, how, and its tracking; null for a pickup. */
  shipment: Shipment | null;
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
  /**
   * What a refund gives back: the total, minus any tree money (trees are ordered once the
   * order is delivered and can't be cancelled, ADR 0022).
   */
  refundableCents: number;
  /** The trees this order funded, once delivered (null before, or while giving is off). */
  trees: { count: number; status: DonationStatus; amountCents: number } | null;
  /** Can a label be bought now (paid, shipped, no label in use)? */
  labelOpen: boolean;
  /** Status changes the admin can make by hand now (shipped, delivered). */
  manualMoves: ('shipped' | 'delivered')[];
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

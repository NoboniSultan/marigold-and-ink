/**
 * Shop orders (milestone 12b, ADR 0020).
 *
 * - The cart lives in the browser. Its prices and stock always come from the shop here,
 *   never from the request (previewCart, startCheckout).
 * - Checkout runs in one transaction: the client's earlier unpaid order is closed (its
 *   stock released, its Stripe page expired), the items are held (the shop locks their
 *   stock rows, so two buyers can't both get the last piece), the order is recorded, and a
 *   Stripe Checkout page is opened for 30 minutes.
 * - Stripe's webhook (or, if one is missed, the release sweep, which asks Stripe itself)
 *   then marks the order paid, or ends it and puts the stock back.
 * - The admin refunds a paid order in full, optionally putting the items back on sale.
 * - Status changes go through the order state machine and are logged in order_events.
 */
import type { PoolClient } from 'pg';
import type {
  Shipment,
  ShippingAddress,
  ShippingAddressInput,
  ShippingPackage,
} from '@shared/types/shipping.ts';
import type {
  AdminOrder,
  CartLine,
  CartPreview,
  CartShippingOption,
  CartShippingQuote,
  CheckoutInput,
  CheckoutStarted,
  Order,
  OrderStatus,
  PricedLine,
  RefundOrderInput,
} from '@shared/types/order.ts';
import type { EmailSender } from '../../adapters/email.ts';
import {
  PaymentGatewayError,
  type PaymentEvent,
  type PaymentGateway,
} from '../../adapters/stripe/stripeGateway.ts';
import { config } from '../../config/env.js';
import { withTransaction } from '../../db/transaction.ts';
import { AppError, BusinessRuleError, ConflictError, NotFoundError } from '../../errors/index.js';
import { assertCanAccessOwnedResource } from '../../lib/authorization.js';
import { hasPlaceholder } from '../../lib/emailText.ts';
import { logger } from '../../lib/logger.js';
import { toLimitOffset, toPageMeta } from '../../lib/pagination.js';
import { requireGateway } from '../payments/payments.service.ts';
import * as shopService from '../shop/shop.service.ts';
import * as usersService from '../users/users.service.ts';
import * as ordersRepository from './orders.repository.ts';
import type { OrderRecord, OrderItemRecord, OrderRefundRecord } from './orders.repository.ts';
import { orderConfirmationEmail } from './orders.emails.ts';
import {
  HOLD_MINUTES,
  SWEEP_GRACE_MS,
  lineCents,
  mergeLines,
  packOrder,
  subtotalCents,
  type PackLine,
  type Packed,
} from './orders.rules.ts';
import {
  ORDER_SYSTEM,
  assertMoveOrder,
  manualMoves,
  type OrderActor,
} from './orders.stateMachine.ts';
import type { ParcelQuote } from '../shipping/shipping.service.ts';
import * as shippingService from '../shipping/shipping.service.ts';
import * as trackingService from '../shipping/shipping.tracking.service.ts';
import { registerShipmentOwner, type OwnerState } from '../shipping/shipping.owners.ts';
import { shippingCents } from '../shipping/shipping.rules.ts';
import type { ShippingRate, ShippingSetup } from '../../adapters/shippo.ts';

interface SessionUser {
  id: number;
  email: string;
  role: 'client' | 'admin';
}

type Email = EmailSender | null | undefined;
/** Work to do once the transaction has committed (emails), never before. */
type AfterCommit = (() => Promise<void>)[];

const orderNotFound = () => new NotFoundError('Order not found', { code: 'ORDER_NOT_FOUND' });

/** Stripe failed or didn't answer: a 502 with a message that's safe to show. */
async function viaGateway<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof PaymentGatewayError)) throw err;
    logger.error({ err }, 'payment provider error');
    throw new AppError("The payment service couldn't be reached. Please try again.", {
      status: 502,
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  }
}

/** Until the shop opens, only the admin can use it (ADR 0019). */
function assertShopVisible(user: SessionUser | undefined, shopOpen: boolean) {
  if (!shopOpen && user?.role !== 'admin') {
    throw new NotFoundError('The shop is not open yet', { code: 'SHOP_CLOSED' });
  }
}

// --- What the API returns ---

/** Everything the order cost: its items plus postage and packaging. */
const totalOf = (order: OrderRecord) => order.subtotalCents + order.shippingCents;

const orderState = (order: OrderRecord): OwnerState => ({
  status: order.status,
  ships: !order.pickup,
});

function toOrder(
  order: OrderRecord,
  items: OrderItemRecord[],
  refunds: OrderRefundRecord[],
  shipment: Shipment | null,
): Order {
  const pending = order.status === 'pending_payment';
  return {
    id: order.id,
    status: order.status,
    items: items.map((item) => ({
      variantId: item.variantId,
      productName: item.productName,
      variantName: item.variantName,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      lineCents: lineCents(item.unitPriceCents, item.quantity),
    })),
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: totalOf(order),
    pickup: order.pickup,
    shipment,
    currency: order.currency,
    refundedCents: refunds
      .filter((r) => r.status === 'succeeded')
      .reduce((sum, r) => sum + r.amountCents, 0),
    checkoutUrl: pending ? order.checkoutUrl : null,
    checkoutExpiresAt: pending ? (order.checkoutExpiresAt?.toISOString() ?? null) : null,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

async function loadOrders(
  orders: OrderRecord[],
  { admin = false }: { admin?: boolean } = {},
): Promise<Order[]> {
  const ids = orders.map((o) => o.id);
  const [items, refunds, shipments] = await Promise.all([
    ordersRepository.itemsFor(ids),
    ordersRepository.refundsFor(ids),
    Promise.all(
      orders.map((o) =>
        o.pickup ? null : shippingService.orderShipment(o.id, orderState(o), { admin }),
      ),
    ),
  ]);
  return orders.map((o, i) =>
    toOrder(
      o,
      items.filter((it) => it.orderId === o.id),
      refunds.filter((r) => r.orderId === o.id),
      shipments[i] ?? null,
    ),
  );
}

// --- Status changes ---

/** Moves an order through the state machine and logs it, in the caller's transaction. */
async function moveOrder(
  order: OrderRecord,
  to: OrderStatus,
  actor: OrderActor,
  reason: string,
  tx: PoolClient,
) {
  assertMoveOrder(order, to, actor);
  await ordersRepository.setStatus(order.id, to, tx);
  await ordersRepository.insertEvent(
    {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      actorType: actor.type,
      actorUserId: actor.type === 'system' ? null : actor.userId,
      reason,
    },
    tx,
  );
}

/** Ends an unpaid order and puts its items back on sale. */
async function endUnpaid(
  order: OrderRecord,
  to: 'expired' | 'canceled',
  actor: OrderActor,
  reason: string,
  tx: PoolClient,
) {
  const items = await ordersRepository.itemsFor([order.id], tx);
  await shopService.putBackStock(items, order.id, 'release', tx);
  await moveOrder(order, to, actor, reason, tx);
}

// --- The cart ---

/** Prices a cart with the shop's current prices and stock. */
export async function previewCart(
  user: SessionUser | undefined,
  lines: CartLine[],
  { shopOpen }: { shopOpen: boolean },
): Promise<CartPreview> {
  assertShopVisible(user, shopOpen);
  const merged = mergeLines(lines);
  const variants = await shopService.cartVariants(merged.map((l) => l.variantId));
  const byId = new Map(variants.filter((v) => v.forSale).map((v) => [v.variantId, v]));
  const priced: PricedLine[] = [];
  const unavailable: number[] = [];
  const packLines: PackLine[] = [];
  for (const line of merged) {
    const v = byId.get(line.variantId);
    if (!v) {
      unavailable.push(line.variantId);
      continue;
    }
    packLines.push(packLineOf(v, line.quantity));
    priced.push({
      variantId: v.variantId,
      productSlug: v.productSlug,
      productName: v.productName,
      variantName: v.variantName,
      unitPriceCents: v.priceCents,
      quantity: line.quantity,
      lineCents: lineCents(v.priceCents, line.quantity),
      available: v.stock,
      ok: v.stock >= line.quantity,
      photo: v.photo,
    });
  }
  return {
    lines: priced,
    unavailable,
    subtotalCents: subtotalCents(priced),
    currency: config.stripe?.currency ?? 'usd',
    ready: priced.length > 0 && unavailable.length === 0 && priced.every((l) => l.ok),
    delivery: deliveryOf(packOrder(packLines)),
  };
}

function packLineOf(v: shopService.CartVariant, quantity: number): PackLine {
  return { quantity, pickupOnly: v.pickupOnly, weightOz: v.weightOz, packing: v.packing };
}

const deliveryOf = (packed: Packed): CartPreview['delivery'] =>
  packed.kind === 'ship' ? 'ship' : packed.kind === 'pickup' ? 'pickup' : 'unavailable';

/** The cart's items for sale, and how it would be packed (without locks: a first look). */
async function cartFacts(lines: CartLine[]) {
  const merged = mergeLines(lines);
  const known = new Map(
    (await shopService.cartVariants(merged.map((l) => l.variantId)))
      .filter((v) => v.forSale)
      .map((v) => [v.variantId, v]),
  );
  const missing = merged.filter((l) => !known.has(l.variantId));
  if (missing.length > 0) {
    throw new ConflictError('Some items in your cart are no longer available in that quantity', {
      code: 'OUT_OF_STOCK',
      details: { items: missing.map((l) => ({ variantId: l.variantId, available: 0 })) },
    });
  }
  const packed = packOrder(merged.map((l) => packLineOf(known.get(l.variantId)!, l.quantity)));
  return { merged, known, packed };
}

function assertShippable(packed: Packed): asserts packed is Extract<Packed, { kind: 'ship' }> {
  if (packed.kind === 'unavailable') {
    throw new ConflictError(
      packed.reason === 'too_heavy'
        ? 'This order is too heavy to ship in one package. Please contact us.'
        : "Some items in your cart can't be shipped yet. Please contact us.",
      { code: 'CART_NOT_SHIPPABLE', details: { reason: packed.reason } },
    );
  }
  if (packed.kind === 'pickup') {
    throw new ConflictError('This order is collected locally, not shipped', {
      code: 'ORDER_IS_PICKUP',
    });
  }
}

const toCartOption = (rate: ShippingRate, packagingFeeCents: number): CartShippingOption => ({
  serviceToken: rate.serviceToken,
  carrier: rate.carrier,
  serviceName: rate.serviceName,
  estimatedDays: rate.estimatedDays,
  postageCents: rate.amountCents,
  packagingFeeCents,
  totalCents: shippingCents(rate.amountCents, packagingFeeCents),
});

/**
 * Live shipping options for a cart to an address (milestone 12c): the address is checked,
 * the order is packed, and each USPS service priced with the packaging fee added.
 */
export async function shippingOptions(
  user: SessionUser,
  lines: CartLine[],
  address: ShippingAddressInput,
  { shopOpen, shipping }: { shopOpen: boolean; shipping?: ShippingSetup | null },
): Promise<CartShippingQuote> {
  assertShopVisible(user, shopOpen);
  const { packed } = await cartFacts(lines);
  assertShippable(packed);
  const quote = await shippingService.quoteParcel(address, packed.parcel, { shipping });
  return {
    address: quote.address,
    options: quote.rates.map((r) => toCartOption(r, quote.packagingFeeCents)),
  };
}

/** The address of the client's last shipped order, to fill in the next one. */
export function lastAddress(user: SessionUser): Promise<ShippingAddress | null> {
  return shippingService.lastOrderAddress(user.id);
}

// --- Checkout ---

/**
 * Closes the client's earlier unpaid orders before a new checkout: each one's Stripe page
 * is checked first (if it was in fact paid, it's recorded as paid), then expired, and its
 * items go back on sale.
 */
async function closeEarlierCheckouts(
  user: SessionUser,
  gateway: PaymentGateway,
  tx: PoolClient,
  after: AfterCommit,
  email: Email,
) {
  for (const order of await ordersRepository.lockPendingForClient(user.id, tx)) {
    const sessionId = order.stripeCheckoutSessionId;
    if (sessionId) {
      const status = await viaGateway(() => gateway.getCheckoutStatus(sessionId));
      if (status.status === 'complete' && status.paid && status.paymentIntentId) {
        await recordPaid(order, status.paymentIntentId, tx, after, email);
        continue;
      }
      if (status.status === 'open') {
        await viaGateway(() => gateway.expireCheckoutSession(sessionId));
      }
    }
    await endUnpaid(
      order,
      'canceled',
      { type: 'client', userId: user.id },
      'A new checkout was started',
      tx,
    );
  }
}

/**
 * Checks out a cart: holds its items and opens a Stripe Checkout page for the total.
 * Answers 409 OUT_OF_STOCK (with what's left of each short item) if anything can't be had.
 */
export async function startCheckout(
  user: SessionUser,
  { items: lines, shipping: chosen }: CheckoutInput,
  {
    gateway: gatewayOrNull,
    email,
    shopOpen,
    shipping,
  }: {
    gateway: PaymentGateway | null;
    email?: Email;
    shopOpen: boolean;
    shipping?: ShippingSetup | null;
  },
): Promise<CheckoutStarted> {
  assertShopVisible(user, shopOpen);
  const { gateway, currency } = requireGateway(gatewayOrNull);
  // A first look without locks, so the order row starts with a real total. The hold below
  // checks again under the locks and corrects the total if a price changed meanwhile.
  const { merged, known, packed } = await cartFacts(lines);

  // Shipping (milestone 12c): priced again here, never taken from the request. The
  // customer's choice is a service; if its price moved since they saw it, they're told.
  let delivery: { quote: ParcelQuote; rate: ShippingRate; parcel: ShippingPackage } | null = null;
  if (packed.kind !== 'pickup') {
    assertShippable(packed);
    if (!chosen) {
      throw new BusinessRuleError('Choose where and how to ship the order', {
        code: 'SHIPPING_REQUIRED',
      });
    }
    const quote = await shippingService.quoteParcel(chosen.address, packed.parcel, { shipping });
    const rate = quote.rates.find((r) => r.serviceToken === chosen.serviceToken);
    const options = quote.rates.map((r) => toCartOption(r, quote.packagingFeeCents));
    if (!rate) {
      throw new ConflictError('That shipping option is no longer available. Please choose again.', {
        code: 'SHIPPING_OPTION_STALE',
        details: { options },
      });
    }
    if (shippingCents(rate.amountCents, quote.packagingFeeCents) !== chosen.expectedCents) {
      throw new ConflictError('The shipping price has changed. Please choose shipping again.', {
        code: 'SHIPPING_PRICE_CHANGED',
        details: { options },
      });
    }
    delivery = { quote, rate, parcel: packed.parcel };
  }
  const chargedShipping = delivery
    ? shippingCents(delivery.rate.amountCents, delivery.quote.packagingFeeCents)
    : 0;
  const after: AfterCommit = [];

  const started = await withTransaction(async (tx) => {
    await closeEarlierCheckouts(user, gateway, tx, after, email);
    const order = await ordersRepository.insertOrder(
      {
        clientId: user.id,
        subtotalCents: subtotalCents(
          merged.map((l) => ({
            unitPriceCents: known.get(l.variantId)!.priceCents,
            quantity: l.quantity,
          })),
        ),
        shippingCents: chargedShipping,
        pickup: packed.kind === 'pickup',
        currency,
      },
      tx,
    );
    const held = await shopService.holdStock(merged, order.id, tx);
    const items = held.map((h) => ({
      variantId: h.variantId,
      productName: h.productName,
      variantName: h.variantName,
      unitPriceCents: h.priceCents,
      quantity: merged.find((l) => l.variantId === h.variantId)!.quantity,
    }));
    await ordersRepository.setSubtotal(order.id, subtotalCents(items), tx);
    await ordersRepository.insertItems(order.id, items, tx);
    if (delivery) await shippingService.recordOrderShipment(order.id, delivery, { client: tx });

    const session = await viaGateway(() =>
      gateway.createOrderCheckout(
        {
          orderId: order.id,
          currency,
          lines: [
            ...items.map((item) => ({
              name: `${item.productName} (${item.variantName})`,
              unitAmountCents: item.unitPriceCents,
              quantity: item.quantity,
            })),
            ...(delivery
              ? [
                  {
                    name: `Shipping & packaging (${delivery.rate.carrier} ${delivery.rate.serviceName})`,
                    unitAmountCents: chargedShipping,
                    quantity: 1,
                  },
                ]
              : []),
          ],
          customerEmail: user.email,
          successUrl: `${config.publicUrl}/orders/${order.id}?payment=success`,
          cancelUrl: `${config.publicUrl}/cart?checkout=cancelled`,
          expiresAt: new Date(Date.now() + HOLD_MINUTES * 60_000),
        },
        { idempotencyKey: `order-checkout-${order.id}` },
      ),
    );
    await ordersRepository.setCheckout(
      order.id,
      { sessionId: session.id, url: session.url, expiresAt: session.expiresAt },
      tx,
    );
    return { orderId: order.id, url: session.url };
  });
  await runAfter(after);
  return started;
}

// --- Paid ---

/** Records the payment and moves the order to paid; the confirmation is emailed after commit. */
async function recordPaid(
  order: OrderRecord,
  paymentIntentId: string,
  tx: PoolClient,
  after: AfterCommit,
  email: Email,
) {
  await ordersRepository.markPaid(order.id, paymentIntentId, tx);
  await moveOrder(order, 'paid', ORDER_SYSTEM, 'Paid', tx);
  after.push(() => sendConfirmation(order.id, email));
}

async function sendConfirmation(orderId: number, email: Email) {
  if (!email) return;
  const record = await ordersRepository.findById(orderId);
  const client = record && (await usersService.findById(record.clientId));
  if (!record || !client) return;
  const [order] = await loadOrders([record]);
  const message = orderConfirmationEmail(client.email, {
    id: order!.id,
    items: order!.items,
    shippingCents: order!.shippingCents,
    pickup: order!.pickup,
    totalCents: order!.totalCents,
    pageUrl: `${config.publicUrl ?? ''}/orders/${orderId}`,
  });
  // The owner's wording isn't written yet: never send placeholder text to a real person.
  if (config.nodeEnv === 'production' && hasPlaceholder(message)) {
    logger.warn({ orderId }, 'order email not sent: its wording is still a placeholder');
    return;
  }
  await email.send(message);
}

/** Runs post-commit work; a failure (an email) is logged, never thrown. */
async function runAfter(after: AfterCommit) {
  for (const task of after) {
    try {
      await task();
    } catch (err) {
      logger.error({ err }, 'after-order step failed');
    }
  }
}

/**
 * Stripe was paid for an order that had already ended (its stock went back on sale): the
 * money is recorded and refunded at once. The key is tied to the session, so a retried
 * webhook gets the same refund rather than a second one.
 */
async function refundLatePayment(
  order: OrderRecord,
  sessionId: string,
  paymentIntentId: string,
  amountCents: number,
  gateway: PaymentGateway,
  tx: PoolClient,
) {
  await ordersRepository.markPaid(order.id, paymentIntentId, tx);
  const refund = await gateway.createRefund(
    { paymentIntentId, amountCents, refundPaymentId: null, orderId: order.id },
    { idempotencyKey: `order-auto-refund-${sessionId}` },
  );
  await ordersRepository.insertRefund(
    {
      orderId: order.id,
      amountCents,
      status: refund.status,
      stripeRefundId: refund.id,
      reason: `Paid after the order had ${order.status === 'expired' ? 'expired' : 'been canceled'}; refunded automatically`,
      restock: false,
      requestedByUserId: null,
    },
    tx,
  );
  logger.warn({ orderId: order.id }, 'payment arrived for an ended order; refunded automatically');
}

// --- Stripe's webhook ---

/**
 * Handles a Stripe event if it belongs to a shop order, inside the webhook's transaction.
 * Returns false for anything else (a commission's payment), which the caller handles.
 */
export async function handleOrderEvent(
  event: PaymentEvent,
  { gateway, email }: { gateway: PaymentGateway; email: Email },
  tx: PoolClient,
  after: AfterCommit,
): Promise<boolean> {
  if (event.type === 'checkout.completed' || event.type === 'checkout.expired') {
    const found = await ordersRepository.findBySessionId(event.session.id, tx);
    if (!found) return false;
    const order = (await ordersRepository.findById(found.id, tx, { forUpdate: true }))!;
    if (event.type === 'checkout.expired') {
      if (order.status === 'pending_payment') {
        await endUnpaid(order, 'expired', ORDER_SYSTEM, 'The payment page expired', tx);
      }
      return true;
    }
    const { session } = event;
    if (!session.paid || !session.paymentIntentId) {
      logger.warn({ orderId: order.id }, 'order Checkout completed without payment; ignored');
      return true;
    }
    if (order.status === 'pending_payment') {
      await recordPaid(order, session.paymentIntentId, tx, after, email);
    } else if (!order.stripePaymentIntentId) {
      await refundLatePayment(
        order,
        session.id,
        session.paymentIntentId,
        session.amountCents ?? totalOf(order),
        gateway,
        tx,
      );
    }
    return true;
  }
  if (event.type === 'refund.changed') {
    const { refund } = event;
    const found = refund.paymentIntentId
      ? await ordersRepository.findByPaymentIntent(refund.paymentIntentId, tx)
      : null;
    if (!found) return false;
    const order = (await ordersRepository.findById(found.id, tx, { forUpdate: true }))!;
    let row = await ordersRepository.findRefundByStripeId(refund.id, tx);
    if (!row) {
      row = await ordersRepository.insertRefund(
        {
          orderId: order.id,
          amountCents: refund.amountCents,
          status: refund.status,
          stripeRefundId: refund.id,
          reason: 'Refunded in the Stripe Dashboard',
          restock: false,
          requestedByUserId: null,
        },
        tx,
      );
    } else if (row.status !== refund.status) {
      row = await ordersRepository.updateRefund(
        row.id,
        { status: refund.status, stripeRefundId: refund.id },
        tx,
      );
    }
    if (row.status === 'succeeded') {
      const actor: OrderActor = row.requestedByUserId
        ? { type: 'admin', userId: row.requestedByUserId }
        : ORDER_SYSTEM;
      await settleRefunds(order, actor, tx);
    }
    return true;
  }
  return false;
}

// --- Refunds ---

/**
 * Once refunds cover the whole order, it becomes refunded; items of refunds marked
 * `restock` go back on sale (once each).
 */
async function settleRefunds(order: OrderRecord, actor: OrderActor, tx: PoolClient) {
  const refunds = await ordersRepository.refundsFor([order.id], tx);
  const refunded = refunds
    .filter((r) => r.status === 'succeeded')
    .reduce((sum, r) => sum + r.amountCents, 0);
  if (refunded >= totalOf(order) && REFUNDABLE_STATUSES.includes(order.status)) {
    await moveOrder(order, 'refunded', actor, 'Refunded in full', tx);
  }
  for (const r of refunds) {
    if (r.status === 'succeeded' && r.restock && !r.restockedAt) {
      const items = await ordersRepository.itemsFor([order.id], tx);
      await shopService.putBackStock(items, order.id, 'return', tx);
      await ordersRepository.markRestocked(r.id, tx);
    }
  }
}

/** Paid orders can be refunded, also after they shipped or arrived (a return). */
const REFUNDABLE_STATUSES: OrderStatus[] = ['paid', 'shipped', 'delivered'];

function refundable(order: OrderRecord, refunds: OrderRefundRecord[]) {
  return (
    REFUNDABLE_STATUSES.includes(order.status) &&
    Boolean(order.stripePaymentIntentId) &&
    !refunds.some((r) => r.status !== 'failed')
  );
}

/** The admin refunds a paid order in full, optionally putting its items back on sale. */
export async function refundOrder(
  admin: SessionUser,
  orderId: number,
  { reason, restock }: RefundOrderInput,
  { gateway: gatewayOrNull }: { gateway: PaymentGateway | null },
): Promise<AdminOrder> {
  const { gateway } = requireGateway(gatewayOrNull);
  await withTransaction(async (tx) => {
    const order = await ordersRepository.findById(orderId, tx, { forUpdate: true });
    if (!order) throw orderNotFound();
    if (!refundable(order, await ordersRepository.refundsFor([orderId], tx))) {
      throw new BusinessRuleError('Only a paid order with no refund yet can be refunded', {
        code: 'ORDER_NOT_REFUNDABLE',
        details: { status: order.status },
      });
    }
    const row = await ordersRepository.insertRefund(
      {
        orderId,
        amountCents: totalOf(order),
        status: 'pending',
        stripeRefundId: null,
        reason,
        restock,
        requestedByUserId: admin.id,
      },
      tx,
    );
    const result = await viaGateway(() =>
      gateway.createRefund(
        {
          paymentIntentId: order.stripePaymentIntentId!,
          amountCents: totalOf(order),
          refundPaymentId: null,
          orderId,
        },
        { idempotencyKey: `order-refund-${row.id}` },
      ),
    );
    const updated = await ordersRepository.updateRefund(
      row.id,
      { status: result.status, stripeRefundId: result.id },
      tx,
    );
    if (updated.status === 'succeeded') {
      await settleRefunds(order, { type: 'admin', userId: admin.id }, tx);
    }
  });
  return getAdminOrder(orderId);
}

// --- Reading ---

export async function getOrder(user: SessionUser, orderId: number): Promise<Order> {
  const order = await ordersRepository.findById(orderId);
  if (!order) throw orderNotFound();
  assertCanAccessOwnedResource(user, order.clientId);
  return (await loadOrders([order]))[0]!;
}

export async function listMyOrders(user: SessionUser, query: { page: number; pageSize: number }) {
  const { orders, total } = await ordersRepository.listForClient(user.id, toLimitOffset(query));
  return { data: await loadOrders(orders), meta: toPageMeta(query, total) };
}

async function withClients(orders: OrderRecord[]) {
  return usersService.findByIds(orders.map((o) => o.clientId));
}

export async function listAdminOrders(query: {
  status?: OrderStatus;
  page: number;
  pageSize: number;
}) {
  const { orders, total } = await ordersRepository.listAll({
    status: query.status,
    ...toLimitOffset(query),
  });
  const [loaded, clients] = await Promise.all([
    loadOrders(orders, { admin: true }),
    withClients(orders),
  ]);
  return {
    data: loaded.map((order, i) => {
      const client = clients.get(orders[i]!.clientId);
      return {
        ...order,
        ...adminShippingFacts(orders[i]!, order),
        client: client
          ? { id: client.id, displayName: client.displayName, email: client.email }
          : null,
      };
    }),
    meta: toPageMeta(query, total),
  };
}

export async function getAdminOrder(orderId: number): Promise<AdminOrder> {
  const order = await ordersRepository.findById(orderId);
  if (!order) throw orderNotFound();
  const [[loaded], events, refunds, clients] = await Promise.all([
    loadOrders([order], { admin: true }),
    ordersRepository.eventsFor(orderId),
    ordersRepository.refundsFor([orderId]),
    withClients([order]),
  ]);
  const client = clients.get(order.clientId);
  return {
    ...loaded!,
    client: client ? { id: client.id, displayName: client.displayName, email: client.email } : null,
    events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    refunds: refunds.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      status: r.status,
      reason: r.reason,
      restock: r.restock,
      restockedAt: r.restockedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    refundable: refundable(order, refunds),
    ...adminShippingFacts(order, loaded!),
  };
}

/** Whether a label can be bought now, and the moves the admin can make by hand. */
function adminShippingFacts(order: OrderRecord, loaded: Order) {
  return {
    labelOpen:
      !order.pickup &&
      order.status === 'paid' &&
      loaded.shipment !== null &&
      !loaded.shipment.label,
    manualMoves: manualMoves(order),
  };
}

// --- Shipping and pickup (milestone 12c) ---

const MANUAL_REASONS = {
  shipped: 'Marked shipped by hand',
  delivered: 'Marked delivered by hand',
  picked: 'Picked up',
} as const;

/** Emails the client about a shipped order's move (its tracking if it has a label). */
async function notifyPackage(orderId: number, to: 'shipped' | 'delivered', email: Email) {
  const order = await ordersRepository.findById(orderId);
  if (!order || order.pickup) return;
  await trackingService.sendPackageEmail(
    {
      clientId: order.clientId,
      status: to,
      shipmentId: (await shippingService.orderShipmentId(orderId)) ?? null,
      pageUrl: `${config.publicUrl ?? ''}/orders/${orderId}`,
      context: { orderId },
    },
    email,
  );
}

/**
 * The admin marks an order shipped or delivered by hand (no label, or before tracking
 * catches up), or a pickup as collected (delivered). Shipped orders' clients are emailed.
 */
export async function markOrder(
  admin: SessionUser,
  orderId: number,
  to: 'shipped' | 'delivered',
  { email }: { email: Email },
): Promise<AdminOrder> {
  const order = await withTransaction(async (tx) => {
    const locked = await ordersRepository.findById(orderId, tx, { forUpdate: true });
    if (!locked) throw orderNotFound();
    const reason = locked.pickup ? MANUAL_REASONS.picked : MANUAL_REASONS[to];
    await moveOrder(locked, to, { type: 'admin', userId: admin.id }, reason, tx);
    return locked;
  });
  if (!order.pickup) {
    await runAfter([() => notifyPackage(orderId, to, email)]);
  }
  return getAdminOrder(orderId);
}

// Orders can own shipments: labels and tracking work on them through this (ADR 0021).
registerShipmentOwner('order', {
  async load(id) {
    const order = await ordersRepository.findById(id);
    if (!order) throw orderNotFound();
    return orderState(order);
  },
  async lock(id, tx) {
    const order = await ordersRepository.findById(id, tx, { forUpdate: true });
    if (!order) throw orderNotFound();
    return orderState(order);
  },
  stage: (state) =>
    !state.ships
      ? 'other'
      : state.status === 'paid'
        ? 'ready'
        : state.status === 'shipped'
          ? 'shipped'
          : state.status === 'delivered'
            ? 'delivered'
            : 'other',
  async move(id, to, reason, _metadata, tx) {
    const order = (await ordersRepository.findById(id, tx, { forUpdate: true }))!;
    await moveOrder(order, to, ORDER_SYSTEM, reason, tx);
  },
  async notify(id, to, email) {
    try {
      await notifyPackage(id, to, email);
    } catch (err) {
      logger.error({ err, orderId: id }, 'order shipping email failed');
    }
  },
  labelNote: (id) => `Order #${id}`,
  adminUrl: (id) => `${config.publicUrl ?? ''}/admin/orders/${id}`,
});

// --- The release sweep ---

/**
 * Pending orders whose Stripe page should have closed a while ago (a webhook was missed):
 * Stripe is asked about each. Paid ones are recorded as paid; expired ones end and their
 * stock goes back on sale. Runs at startup and every few minutes; never throws.
 */
export async function releaseExpiredOrders({
  gateway,
  email,
  now = new Date(),
}: {
  gateway: PaymentGateway | null;
  email: Email;
  now?: Date;
}): Promise<{ paid: number; expired: number; failed: number }> {
  const result = { paid: 0, expired: 0, failed: 0 };
  if (!gateway) return result;
  try {
    const due = await ordersRepository.pendingExpiredBefore(
      new Date(now.getTime() - SWEEP_GRACE_MS),
    );
    for (const candidate of due) {
      try {
        const status = await gateway.getCheckoutStatus(candidate.stripeCheckoutSessionId!);
        if (status.status === 'open') continue;
        // Completed but not paid yet: a delayed payment method. Its stock stays held; the
        // order is left for the owner to look at rather than released under a paying client.
        if (status.status === 'complete' && !status.paid) {
          logger.warn({ orderId: candidate.id }, 'order paid by a delayed method; still waiting');
          continue;
        }
        const after: AfterCommit = [];
        await withTransaction(async (tx) => {
          const order = (await ordersRepository.findById(candidate.id, tx, { forUpdate: true }))!;
          if (order.status !== 'pending_payment') return; // the webhook got there first
          if (status.status === 'complete' && status.paid && status.paymentIntentId) {
            await recordPaid(order, status.paymentIntentId, tx, after, email);
            result.paid += 1;
          } else {
            await endUnpaid(order, 'expired', ORDER_SYSTEM, 'The payment page expired', tx);
            result.expired += 1;
          }
        });
        await runAfter(after);
      } catch (err) {
        result.failed += 1;
        logger.error({ err, orderId: candidate.id }, 'could not settle an expired order');
      }
    }
  } catch (err) {
    logger.error({ err }, 'order release sweep failed');
  }
  if (result.paid + result.expired + result.failed > 0) logger.info(result, 'orders swept');
  return result;
}

// --- Account deletion and export ---

/**
 * A deleted client's unpaid orders end and their items go back on sale (in the deletion's
 * transaction). Returns their Stripe pages, to close once it commits.
 */
export async function cancelPendingForDeletedClient(
  clientId: number,
  { client }: { client: PoolClient },
): Promise<string[]> {
  const sessions: string[] = [];
  for (const order of await ordersRepository.lockPendingForClient(clientId, client)) {
    await endUnpaid(order, 'canceled', ORDER_SYSTEM, 'The account was deleted', client);
    if (order.stripeCheckoutSessionId) sessions.push(order.stripeCheckoutSessionId);
  }
  return sessions;
}

/** Closes Stripe pages after the fact. Best effort: a late payment is refunded by the webhook. */
export async function expireCheckoutPages(sessionIds: string[], gateway: PaymentGateway | null) {
  if (!gateway) return;
  for (const sessionId of sessionIds) {
    try {
      await gateway.expireCheckoutSession(sessionId);
    } catch (err) {
      logger.warn({ err, sessionId }, 'could not expire an order Checkout page');
    }
  }
}

/** A client's orders for their data download (all of them, newest first). */
export async function ordersForExport(clientId: number): Promise<Order[]> {
  const { orders } = await ordersRepository.listForClient(clientId, { limit: 10_000, offset: 0 });
  return loadOrders(orders);
}

/** Shop sales and refunds per month, for the monthly report. */
export function monthlyShop(year: number, timeZone: string) {
  return ordersRepository.monthlyShop(year, timeZone);
}

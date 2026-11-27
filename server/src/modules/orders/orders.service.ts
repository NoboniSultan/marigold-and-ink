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
  AdminOrder,
  CartLine,
  CartPreview,
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
  subtotalCents,
} from './orders.rules.ts';
import { ORDER_SYSTEM, assertMoveOrder, type OrderActor } from './orders.stateMachine.ts';

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

function toOrder(
  order: OrderRecord,
  items: OrderItemRecord[],
  refunds: OrderRefundRecord[],
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

async function loadOrders(orders: OrderRecord[], client?: PoolClient): Promise<Order[]> {
  const ids = orders.map((o) => o.id);
  const [items, refunds] = await Promise.all([
    ordersRepository.itemsFor(ids, client),
    ordersRepository.refundsFor(ids, client),
  ]);
  return orders.map((o) =>
    toOrder(
      o,
      items.filter((i) => i.orderId === o.id),
      refunds.filter((r) => r.orderId === o.id),
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
  for (const line of merged) {
    const v = byId.get(line.variantId);
    if (!v) {
      unavailable.push(line.variantId);
      continue;
    }
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
  };
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
  lines: CartLine[],
  {
    gateway: gatewayOrNull,
    email,
    shopOpen,
  }: { gateway: PaymentGateway | null; email?: Email; shopOpen: boolean },
): Promise<CheckoutStarted> {
  assertShopVisible(user, shopOpen);
  const { gateway, currency } = requireGateway(gatewayOrNull);
  const merged = mergeLines(lines);
  // A first look without locks, so the order row starts with a real total. The hold below
  // checks again under the locks and corrects the total if a price changed meanwhile.
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

    const session = await viaGateway(() =>
      gateway.createOrderCheckout(
        {
          orderId: order.id,
          currency,
          lines: items.map((item) => ({
            name: `${item.productName} (${item.variantName})`,
            unitAmountCents: item.unitPriceCents,
            quantity: item.quantity,
          })),
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
    subtotalCents: order!.subtotalCents,
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
        session.amountCents ?? order.subtotalCents,
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
  if (refunded >= order.subtotalCents && order.status === 'paid') {
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

function refundable(order: OrderRecord, refunds: OrderRefundRecord[]) {
  return (
    order.status === 'paid' &&
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
        amountCents: order.subtotalCents,
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
          amountCents: order.subtotalCents,
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
  const [loaded, clients] = await Promise.all([loadOrders(orders), withClients(orders)]);
  return {
    data: loaded.map((order, i) => {
      const client = clients.get(orders[i]!.clientId);
      return {
        ...order,
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
    loadOrders([order]),
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
  };
}

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

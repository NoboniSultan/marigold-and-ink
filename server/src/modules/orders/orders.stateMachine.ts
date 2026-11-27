/**
 * A shop order's lifecycle as data (milestone 12b, ADR 0020), like the commission's: which
 * status changes exist and who may make each. Pure, so every rule is unit-tested; the
 * service applies a change and writes an order_events row in one transaction.
 *
 *   pending_payment → paid       (system: Stripe says it's paid)
 *   pending_payment → expired    (system: the Stripe page closed unpaid; stock released)
 *   pending_payment → canceled   (the client started a new checkout, or the system on
 *                                 account deletion; stock released)
 *   paid            → shipped    (a shipped order: tracking's first scan, or the admin)
 *   shipped         → delivered  (tracking, or the admin)
 *   paid            → delivered  (a pickup, collected: the admin)
 *   paid, shipped,
 *   delivered       → refunded   (the admin refunds it in full, or the system records a
 *                                 full refund made in the Stripe Dashboard)
 */
import type { OrderStatus } from '@shared/types/order.ts';
import { ConflictError, ForbiddenError } from '../../errors/index.js';

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'shipped',
  'delivered',
  'expired',
  'canceled',
  'refunded',
] as const satisfies readonly OrderStatus[];

export type OrderActor = { type: 'client' | 'admin'; userId: number } | { type: 'system' };

export const ORDER_SYSTEM: OrderActor = Object.freeze({ type: 'system' });

interface OrderTransition {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly actors: readonly OrderActor['type'][];
  /** Only for shipped orders (false), or only for pickups (true). */
  readonly pickup?: boolean;
}

export const ORDER_TRANSITIONS: readonly OrderTransition[] = Object.freeze([
  { from: 'pending_payment', to: 'paid', actors: ['system'] },
  { from: 'pending_payment', to: 'expired', actors: ['system'] },
  { from: 'pending_payment', to: 'canceled', actors: ['client', 'system'] },
  { from: 'paid', to: 'shipped', actors: ['admin', 'system'], pickup: false },
  { from: 'shipped', to: 'delivered', actors: ['admin', 'system'] },
  { from: 'paid', to: 'delivered', actors: ['admin'], pickup: true },
  { from: 'paid', to: 'refunded', actors: ['admin', 'system'] },
  { from: 'shipped', to: 'refunded', actors: ['admin', 'system'] },
  { from: 'delivered', to: 'refunded', actors: ['admin', 'system'] },
] satisfies OrderTransition[]);

export type OrderTransitionResult =
  { allowed: true } | { allowed: false; kind: 'invalid' | 'forbidden'; message: string };

/**
 * May `actor` move an order of `clientId` from `from` to `to`? A client may only act on
 * their own order.
 */
export function canMoveOrder(
  order: { status: OrderStatus; clientId: number; pickup?: boolean },
  to: OrderStatus,
  actor: OrderActor,
): OrderTransitionResult {
  const transition = ORDER_TRANSITIONS.find(
    (t) =>
      t.from === order.status &&
      t.to === to &&
      (t.pickup === undefined || t.pickup === Boolean(order.pickup)),
  );
  if (!transition) {
    return {
      allowed: false,
      kind: 'invalid',
      message: `Can't move an order from ${order.status} to ${to}`,
    };
  }
  const own = actor.type !== 'client' || actor.userId === order.clientId;
  if (!transition.actors.includes(actor.type) || !own) {
    return { allowed: false, kind: 'forbidden', message: `You can't move this order to ${to}` };
  }
  return { allowed: true };
}

/** Like canMoveOrder, but throws the matching API error. */
export function assertMoveOrder(
  order: { status: OrderStatus; clientId: number; pickup?: boolean },
  to: OrderStatus,
  actor: OrderActor,
): void {
  const result = canMoveOrder(order, to, actor);
  if (result.allowed) return;
  const details = { from: order.status, to };
  if (result.kind === 'forbidden') {
    throw new ForbiddenError(result.message, { code: 'ORDER_TRANSITION_FORBIDDEN', details });
  }
  throw new ConflictError(result.message, { code: 'ORDER_INVALID_TRANSITION', details });
}

/** The moves the admin can make by hand now (marking shipped, delivered, or picked up). */
export function manualMoves(order: {
  status: OrderStatus;
  clientId: number;
  pickup: boolean;
}): ('shipped' | 'delivered')[] {
  return (['shipped', 'delivered'] as const).filter(
    (to) => canMoveOrder(order, to, { type: 'admin', userId: 0 }).allowed,
  );
}

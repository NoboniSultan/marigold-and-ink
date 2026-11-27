/**
 * A shop order's lifecycle as data (milestone 12b, ADR 0020), like the commission's: which
 * status changes exist and who may make each. Pure, so every rule is unit-tested; the
 * service applies a change and writes an order_events row in one transaction.
 *
 *   pending_payment → paid       (system: Stripe says it's paid)
 *   pending_payment → expired    (system: the Stripe page closed unpaid; stock released)
 *   pending_payment → canceled   (the client started a new checkout, or the system on
 *                                 account deletion; stock released)
 *   paid            → refunded   (the admin refunds it in full, or the system records a
 *                                 full refund made in the Stripe Dashboard)
 *
 * Shipping (12c) will add paid → shipped → delivered.
 */
import type { OrderStatus } from '@shared/types/order.ts';
import { ConflictError, ForbiddenError } from '../../errors/index.js';

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
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
}

export const ORDER_TRANSITIONS: readonly OrderTransition[] = Object.freeze([
  { from: 'pending_payment', to: 'paid', actors: ['system'] },
  { from: 'pending_payment', to: 'expired', actors: ['system'] },
  { from: 'pending_payment', to: 'canceled', actors: ['client', 'system'] },
  { from: 'paid', to: 'refunded', actors: ['admin', 'system'] },
] satisfies OrderTransition[]);

export type OrderTransitionResult =
  { allowed: true } | { allowed: false; kind: 'invalid' | 'forbidden'; message: string };

/**
 * May `actor` move an order of `clientId` from `from` to `to`? A client may only act on
 * their own order.
 */
export function canMoveOrder(
  order: { status: OrderStatus; clientId: number },
  to: OrderStatus,
  actor: OrderActor,
): OrderTransitionResult {
  const transition = ORDER_TRANSITIONS.find((t) => t.from === order.status && t.to === to);
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
  order: { status: OrderStatus; clientId: number },
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

import { describe, it, expect } from 'vitest';
import type { OrderStatus } from '@shared/types/order.ts';
import {
  ORDER_STATUSES,
  ORDER_SYSTEM,
  assertMoveOrder,
  canMoveOrder,
  manualMoves,
  type OrderActor,
} from '../orders.stateMachine.ts';

// The allowed moves, written out independently of the table under test.
// `ship` and `pickup` say which kind of order a move is for (both when unmarked).
const EXPECTED: Record<string, { actors: OrderActor['type'][]; only?: 'ship' | 'pickup' }> = {
  'pending_payment>paid': { actors: ['system'] },
  'pending_payment>expired': { actors: ['system'] },
  'pending_payment>canceled': { actors: ['client', 'system'] },
  'paid>shipped': { actors: ['admin', 'system'], only: 'ship' },
  'shipped>delivered': { actors: ['admin', 'system'] },
  'paid>delivered': { actors: ['admin'], only: 'pickup' },
  'paid>refunded': { actors: ['admin', 'system'] },
  'shipped>refunded': { actors: ['admin', 'system'] },
  'delivered>refunded': { actors: ['admin', 'system'] },
};

const CLIENT: OrderActor = { type: 'client', userId: 7 };
const OTHER_CLIENT: OrderActor = { type: 'client', userId: 8 };
const ADMIN: OrderActor = { type: 'admin', userId: 1 };
const ACTORS = { client: CLIENT, admin: ADMIN, system: ORDER_SYSTEM } as const;

const order = (status: OrderStatus, pickup = false) => ({ status, clientId: 7, pickup });

describe('the order state machine', () => {
  const pairs = ORDER_STATUSES.flatMap((from) =>
    ORDER_STATUSES.flatMap((to) =>
      (['client', 'admin', 'system'] as const).flatMap((actor) =>
        [false, true].map((pickup) => [from, to, actor, pickup] as const),
      ),
    ),
  );

  it.each(pairs)('%s → %s by %s (pickup: %s)', (from, to, actor, pickup) => {
    const rule = EXPECTED[`${from}>${to}`];
    const allowed =
      Boolean(rule?.actors.includes(actor)) && (!rule?.only || (rule.only === 'pickup') === pickup);
    expect(canMoveOrder(order(from, pickup), to, ACTORS[actor]).allowed).toBe(allowed);
  });

  it('offers the admin the moves they can make by hand', () => {
    expect(manualMoves(order('paid'))).toEqual(['shipped']);
    expect(manualMoves(order('shipped'))).toEqual(['delivered']);
    expect(manualMoves(order('paid', true))).toEqual(['delivered']);
    expect(manualMoves(order('pending_payment'))).toEqual([]);
  });

  it('lets a client cancel only their own order', () => {
    expect(canMoveOrder(order('pending_payment'), 'canceled', OTHER_CLIENT)).toMatchObject({
      allowed: false,
      kind: 'forbidden',
    });
  });

  it('throws 409 for a move that does not exist, and 403 for the wrong actor', () => {
    expect(() => assertMoveOrder(order('expired'), 'paid', ORDER_SYSTEM)).toThrow(
      expect.objectContaining({ status: 409, code: 'ORDER_INVALID_TRANSITION' }),
    );
    expect(() => assertMoveOrder(order('pending_payment'), 'paid', CLIENT)).toThrow(
      expect.objectContaining({ status: 403, code: 'ORDER_TRANSITION_FORBIDDEN' }),
    );
    expect(() => assertMoveOrder(order('paid'), 'refunded', ADMIN)).not.toThrow();
  });
});

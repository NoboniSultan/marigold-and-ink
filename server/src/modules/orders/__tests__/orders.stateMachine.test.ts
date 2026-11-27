import { describe, it, expect } from 'vitest';
import type { OrderStatus } from '@shared/types/order.ts';
import {
  ORDER_STATUSES,
  ORDER_SYSTEM,
  assertMoveOrder,
  canMoveOrder,
  type OrderActor,
} from '../orders.stateMachine.ts';

// The allowed moves, written out independently of the table under test.
const EXPECTED: Record<string, OrderActor['type'][]> = {
  'pending_payment>paid': ['system'],
  'pending_payment>expired': ['system'],
  'pending_payment>canceled': ['client', 'system'],
  'paid>refunded': ['admin', 'system'],
};

const CLIENT: OrderActor = { type: 'client', userId: 7 };
const OTHER_CLIENT: OrderActor = { type: 'client', userId: 8 };
const ADMIN: OrderActor = { type: 'admin', userId: 1 };
const ACTORS = { client: CLIENT, admin: ADMIN, system: ORDER_SYSTEM } as const;

const order = (status: OrderStatus) => ({ status, clientId: 7 });

describe('the order state machine', () => {
  const pairs = ORDER_STATUSES.flatMap((from) =>
    ORDER_STATUSES.flatMap((to) =>
      (['client', 'admin', 'system'] as const).map((actor) => [from, to, actor] as const),
    ),
  );

  it.each(pairs)('%s → %s by %s', (from, to, actor) => {
    const allowed = EXPECTED[`${from}>${to}`]?.includes(actor) ?? false;
    expect(canMoveOrder(order(from), to, ACTORS[actor]).allowed).toBe(allowed);
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

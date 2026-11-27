/**
 * What a shipment belongs to (milestone 12c, ADR 0021): a commission, or a shop order. The
 * label and tracking code works with either through this small interface: read or lock the
 * owner, say where it stands for shipping, move it to shipped or delivered, and tell the
 * client.
 *
 * Commissions are built in. Orders register themselves (orders.service.ts) when that module
 * loads, so this module never imports the orders module (which imports this one).
 */
import type { PoolClient } from 'pg';
import type { EmailSender } from '../../adapters/email.ts';
import { config } from '../../config/env.js';
import * as commissionsService from '../commissions/commissions.service.js';
import { SYSTEM_ACTOR } from '../commissions/commissions.stateMachine.ts';
import { ships } from './shipping.rules.ts';

export type OwnerKind = 'commission' | 'order';

export interface OwnerRef {
  kind: OwnerKind;
  id: number;
}

/** Where an owner stands for shipping. */
export type ShippingStage = 'ready' | 'shipped' | 'delivered' | 'other';

export interface OwnerState {
  status: string;
  /** Does it ship at all (physical commission; order that isn't a pickup)? */
  ships: boolean;
}

export interface OwnerHandler {
  /** Reads it (404 if it doesn't exist). */
  load(id: number): Promise<OwnerState>;
  /** Locks its row in the caller's transaction, then reads it. */
  lock(id: number, tx: PoolClient): Promise<OwnerState>;
  stage(state: OwnerState): ShippingStage;
  /** Moves it on as the system (from tracking), in the caller's transaction. */
  move(
    id: number,
    to: 'shipped' | 'delivered',
    reason: string,
    metadata: Record<string, unknown>,
    tx: PoolClient,
  ): Promise<void>;
  /** Emails the client about a move, after it committed. Never throws. */
  notify(
    id: number,
    to: 'shipped' | 'delivered',
    email: EmailSender | null | undefined,
  ): Promise<void>;
  /** Shown with the label in the shipping service's dashboard. */
  labelNote(id: number): string;
  /** Its admin page. */
  adminUrl(id: number): string;
}

const commissionStage = (status: string): ShippingStage =>
  status === 'ready_to_ship'
    ? 'ready'
    : status === 'shipped'
      ? 'shipped'
      : status === 'delivered'
        ? 'delivered'
        : 'other';

const commissionHandler: OwnerHandler = {
  async load(id) {
    const c = await commissionsService.lockCommission(id, undefined);
    return { status: c.status, ships: ships(c.fulfillmentType) };
  },
  async lock(id, tx) {
    const c = await commissionsService.lockCommission(id, tx);
    return { status: c.status, ships: ships(c.fulfillmentType) };
  },
  stage: (state) => commissionStage(state.status),
  async move(id, to, reason, metadata, tx) {
    await commissionsService.applyTransition(
      { commissionId: id, toStatus: to, actor: SYSTEM_ACTOR, reason, metadata },
      { client: tx },
    );
  },
  async notify(id, to, email) {
    // Imported when needed: the tracking service imports this module.
    const { notifyStatusChange } = await import('./shipping.tracking.service.ts');
    const commission = await commissionsService.lockCommission(id, undefined);
    // About the move that happened, not where it stands now (delivered as the first news
    // moves through shipped: one email for each).
    await notifyStatusChange({ ...commission, status: to }, email);
  },
  labelNote: (id) => `Commission #${id}`,
  adminUrl: (id) => `${config.publicUrl ?? ''}/admin/commissions/${id}`,
};

const handlers: Partial<Record<OwnerKind, OwnerHandler>> = { commission: commissionHandler };

/** Called by the orders module when it loads. */
export function registerShipmentOwner(kind: OwnerKind, handler: OwnerHandler) {
  handlers[kind] = handler;
}

export function ownerHandler(kind: OwnerKind): OwnerHandler {
  const handler = handlers[kind];
  if (!handler) throw new Error(`No shipment owner registered for ${kind}`);
  return handler;
}

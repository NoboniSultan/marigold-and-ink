/**
 * The commission lifecycle as data: which status changes exist, who may make each one,
 * and any extra rule (guard) that must hold. Pure: no database, no HTTP, no clock, so
 * every rule is unit-tested directly. The service applies a transition by updating the
 * commission and writing a commission_events row in one database transaction.
 * See docs/state-machine.md for the diagram.
 */
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../errors/index.js';
import type { FulfillmentType } from '../pricing/pricing.engine.ts';

// `as const` keeps each string as its own literal type, so CommissionStatus below is the
// union 'inquiry' | 'quoted' | ... instead of plain `string`. The list stays the single
// source: add a status here and the type follows.
export const STATUSES = Object.freeze([
  'inquiry',
  'quoted',
  'deposit_paid',
  'in_progress',
  'revision',
  'awaiting_final_payment',
  'ready_to_ship',
  'shipped',
  'delivered',
  'completed',
  'canceled',
  'refunded',
] as const);
export type CommissionStatus = (typeof STATUSES)[number];

export const TERMINAL_STATUSES: readonly CommissionStatus[] = Object.freeze([
  'completed',
  'canceled',
  'refunded',
]);

/** Actor types: the commission's own client, an admin, or the system (e.g. a Stripe webhook). */
export const ACTOR_TYPES = Object.freeze(['client', 'admin', 'system'] as const);
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * Who is making a change. A discriminated union: checking `actor.type` tells TypeScript
 * whether `userId` exists, so the system actor can never be mistaken for a user.
 */
export type Actor = { type: 'client' | 'admin'; userId: number } | { type: 'system' };

export const SYSTEM_ACTOR: Actor = Object.freeze({ type: 'system' });

/** Maps a logged-in user to an actor. */
export function actorFromUser(user: { id: number; role: string }): Actor {
  return { type: user.role === 'admin' ? 'admin' : 'client', userId: user.id };
}

/** The commission fields the state machine reads. Callers may pass a full row. */
export interface CommissionState {
  status: CommissionStatus;
  clientId: number;
  revisionCount: number;
  revisionLimit: number;
  fulfillmentType: FulfillmentType;
}

/** Field updates that come with a transition (always the new status). */
export interface TransitionChanges {
  status: CommissionStatus;
  revisionCount?: number;
}

/** Why a transition is refused. Only business failures carry their own error code. */
export type TransitionFailure =
  | { kind: 'invalid' | 'forbidden'; message: string }
  | { kind: 'business'; code: string; message: string };

/** Dedicated flows that own a transition (see `via` below). */
export type TransitionFlow = 'quote' | 'refund';

type Guard = (commission: CommissionState) => TransitionFailure | null;

export interface Transition {
  readonly from: CommissionStatus;
  readonly to: CommissionStatus;
  readonly actors: readonly ActorType[];
  readonly guard?: Guard;
  readonly effect?: (commission: CommissionState) => Omit<TransitionChanges, 'status'>;
  readonly via?: TransitionFlow;
}

export type TransitionResult =
  | { allowed: true; transition: Transition; changes: TransitionChanges }
  | { allowed: false; failure: TransitionFailure };

// --- Guards: return null when the rule holds, or a failure describing why not. ---

const revisionAvailable: Guard = (commission) => {
  if (commission.revisionCount < commission.revisionLimit) return null;
  return {
    kind: 'business',
    code: 'REVISION_LIMIT_REACHED',
    message: `All ${commission.revisionLimit} revisions have been used`,
  };
};

const shipsPhysically: Guard = (commission) => {
  if (commission.fulfillmentType !== 'digital') return null;
  return { kind: 'invalid', message: 'Digital-only commissions are delivered, not shipped' };
};

const digitalOnly: Guard = (commission) => {
  if (commission.fulfillmentType === 'digital') return null;
  return {
    kind: 'invalid',
    message: 'Physical and mixed-media commissions must be shipped before delivery',
  };
};

/**
 * Every allowed status change. Anything not listed is invalid.
 * - actors: who may trigger it ('client' means the commission's own client).
 * - guard:  extra rule that must hold (optional).
 * - effect: field changes that come with it (optional).
 * - via:    the change is only allowed through a dedicated flow that does more than flip
 *           the status: 'quote' (sending a quote records the price) and 'refund'
 *           (milestone 7 moves the money). The generic status endpoint can't use these.
 *
 * `satisfies` checks every entry against Transition (a typo like 'in_progres' fails the
 * type check) without widening the array's type.
 */
const TRANSITION_TABLE = [
  { from: 'inquiry', to: 'quoted', actors: ['admin'], via: 'quote' },
  { from: 'inquiry', to: 'canceled', actors: ['client', 'admin'] },
  { from: 'quoted', to: 'canceled', actors: ['client', 'admin'] },
  { from: 'quoted', to: 'deposit_paid', actors: ['system'] },
  { from: 'deposit_paid', to: 'in_progress', actors: ['admin'] },
  { from: 'deposit_paid', to: 'refunded', actors: ['admin', 'system'], via: 'refund' },
  { from: 'in_progress', to: 'revision', actors: ['client'], guard: revisionAvailable },
  { from: 'in_progress', to: 'awaiting_final_payment', actors: ['client', 'admin'] },
  { from: 'in_progress', to: 'refunded', actors: ['admin', 'system'], via: 'refund' },
  {
    from: 'revision',
    to: 'in_progress',
    actors: ['admin'],
    // A revision counts as used once the artist has delivered it.
    effect: (commission) => ({ revisionCount: commission.revisionCount + 1 }),
  },
  {
    from: 'awaiting_final_payment',
    to: 'ready_to_ship',
    actors: ['system'],
    guard: shipsPhysically,
  },
  { from: 'awaiting_final_payment', to: 'delivered', actors: ['system'], guard: digitalOnly },
  { from: 'awaiting_final_payment', to: 'refunded', actors: ['admin', 'system'], via: 'refund' },
  { from: 'ready_to_ship', to: 'shipped', actors: ['admin'] },
  { from: 'shipped', to: 'delivered', actors: ['admin'] },
  { from: 'delivered', to: 'completed', actors: ['admin'] },
] satisfies Transition[];

export const TRANSITIONS: readonly Transition[] = Object.freeze(
  TRANSITION_TABLE.map((t): Transition => Object.freeze({ ...t, actors: Object.freeze(t.actors) })),
);

function findTransition(from: CommissionStatus, to: string): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

function actorMayTrigger(
  transition: Transition,
  commission: CommissionState,
  actor: Actor | null | undefined,
): boolean {
  if (!actor || !transition.actors.includes(actor.type)) return false;
  // A client may only act on their own commission.
  if (actor.type === 'client') return actor.userId === commission.clientId;
  return true;
}

/**
 * Checks whether `actor` may move `commission` to `toStatus`.
 * Returns { allowed: true, transition, changes } where `changes` are the field updates
 * to save (always including the new status), or { allowed: false, failure } where
 * failure.kind is 'invalid' (no such move), 'forbidden' (not this actor), or
 * 'business' (a rule like the revision limit blocks it).
 *
 * options.via names the dedicated flow making the call ('quote', 'refund').
 * `toStatus` is a plain string because it comes from requests; unknown values are
 * simply not in TRANSITIONS and fail as 'invalid'.
 */
export function canTransition(
  commission: CommissionState,
  toStatus: string,
  actor: Actor | null | undefined,
  { via }: { via?: TransitionFlow } = {},
): TransitionResult {
  const from = commission.status;
  const transition = findTransition(from, toStatus);

  if (!transition) {
    const message = TERMINAL_STATUSES.includes(from)
      ? `A ${from} commission can't change status`
      : `Can't move a commission from ${from} to ${toStatus}`;
    return { allowed: false, failure: { kind: 'invalid', message } };
  }

  if (transition.via && transition.via !== via) {
    return {
      allowed: false,
      failure: {
        kind: 'invalid',
        message: `Moving to ${toStatus} requires the ${transition.via} flow`,
      },
    };
  }

  if (!actorMayTrigger(transition, commission, actor)) {
    return {
      allowed: false,
      failure: { kind: 'forbidden', message: `You can't move this commission to ${toStatus}` },
    };
  }

  const guardFailure = transition.guard?.(commission);
  if (guardFailure) return { allowed: false, failure: guardFailure };

  const changes: TransitionChanges = { status: transition.to, ...transition.effect?.(commission) };
  return { allowed: true, transition, changes };
}

/** Like canTransition, but throws the matching API error instead of returning a failure. */
export function assertTransition(
  commission: CommissionState,
  toStatus: string,
  actor: Actor | null | undefined,
  options?: { via?: TransitionFlow },
): Extract<TransitionResult, { allowed: true }> {
  const result = canTransition(commission, toStatus, actor, options);
  if (result.allowed) return result;

  const { failure } = result;
  const details = { from: commission.status, to: toStatus };
  if (failure.kind === 'forbidden') {
    throw new ForbiddenError(failure.message, { code: 'COMMISSION_TRANSITION_FORBIDDEN', details });
  }
  if (failure.kind === 'business') {
    throw new BusinessRuleError(failure.message, { code: failure.code, details });
  }
  throw new ConflictError(failure.message, { code: 'COMMISSION_INVALID_TRANSITION', details });
}

/**
 * Statuses this actor could move the commission to right now through the generic
 * status endpoint (flows with `via` excluded). Lets a client UI show only valid actions.
 */
export function availableTransitions(
  commission: CommissionState,
  actor: Actor | null | undefined,
): CommissionStatus[] {
  return TRANSITIONS.filter((t) => t.from === commission.status && !t.via)
    .filter((t) => canTransition(commission, t.to, actor).allowed)
    .map((t) => t.to);
}

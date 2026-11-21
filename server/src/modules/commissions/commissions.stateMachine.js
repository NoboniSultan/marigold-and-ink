/**
 * The commission lifecycle as data: which status changes exist, who may make each one,
 * and any extra rule (guard) that must hold. Pure: no database, no HTTP, no clock, so
 * every rule is unit-tested directly. The service applies a transition by updating the
 * commission and writing a commission_events row in one database transaction.
 * See docs/state-machine.md for the diagram.
 */
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../errors/index.js';

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
]);

export const TERMINAL_STATUSES = Object.freeze(['completed', 'canceled', 'refunded']);

/** Actor types: the commission's own client, an admin, or the system (e.g. a Stripe webhook). */
export const ACTOR_TYPES = Object.freeze(['client', 'admin', 'system']);
export const SYSTEM_ACTOR = Object.freeze({ type: 'system' });

/** Maps a logged-in user to an actor. */
export function actorFromUser(user) {
  return { type: user.role === 'admin' ? 'admin' : 'client', userId: user.id };
}

// --- Guards: return null when the rule holds, or a failure describing why not. ---

function revisionAvailable(commission) {
  if (commission.revisionCount < commission.revisionLimit) return null;
  return {
    kind: 'business',
    code: 'REVISION_LIMIT_REACHED',
    message: `All ${commission.revisionLimit} revisions have been used`,
  };
}

function shipsPhysically(commission) {
  if (commission.fulfillmentType !== 'digital') return null;
  return { kind: 'invalid', message: 'Digital-only commissions are delivered, not shipped' };
}

function digitalOnly(commission) {
  if (commission.fulfillmentType === 'digital') return null;
  return {
    kind: 'invalid',
    message: 'Physical and mixed-media commissions must be shipped before delivery',
  };
}

/**
 * Every allowed status change. Anything not listed is invalid.
 * - actors: who may trigger it ('client' means the commission's own client).
 * - guard:  extra rule that must hold (optional).
 * - effect: field changes that come with it (optional).
 * - via:    the change is only allowed through a dedicated flow that does more than flip
 *           the status: 'quote' (sending a quote records the price) and 'refund'
 *           (milestone 7 moves the money). The generic status endpoint can't use these.
 */
export const TRANSITIONS = Object.freeze(
  [
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
  ].map((t) => Object.freeze({ ...t, actors: Object.freeze(t.actors) })),
);

function findTransition(from, to) {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

function actorMayTrigger(transition, commission, actor) {
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
 */
export function canTransition(commission, toStatus, actor, { via } = {}) {
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

  const changes = { status: toStatus, ...transition.effect?.(commission) };
  return { allowed: true, transition, changes };
}

/** Like canTransition, but throws the matching API error instead of returning a failure. */
export function assertTransition(commission, toStatus, actor, options) {
  const result = canTransition(commission, toStatus, actor, options);
  if (result.allowed) return result;

  const { kind, code, message } = result.failure;
  const details = { from: commission.status, to: toStatus };
  if (kind === 'forbidden') {
    throw new ForbiddenError(message, { code: 'COMMISSION_TRANSITION_FORBIDDEN', details });
  }
  if (kind === 'business') {
    throw new BusinessRuleError(message, { code, details });
  }
  throw new ConflictError(message, { code: 'COMMISSION_INVALID_TRANSITION', details });
}

/**
 * Statuses this actor could move the commission to right now through the generic
 * status endpoint (flows with `via` excluded). Lets a client UI show only valid actions.
 */
export function availableTransitions(commission, actor) {
  return TRANSITIONS.filter((t) => t.from === commission.status && !t.via)
    .filter((t) => canTransition(commission, t.to, actor).allowed)
    .map((t) => t.to);
}

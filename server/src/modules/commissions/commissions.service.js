import * as commissionsRepository from './commissions.repository.js';
import * as pricingService from '../pricing/pricing.service.js';
import {
  actorFromUser,
  assertTransition,
  availableTransitions,
} from './commissions.stateMachine.ts';
import { withTransaction } from '../../db/transaction.ts';
import { BusinessRuleError, NotFoundError } from '../../errors/index.js';
import { assertCanAccessOwnedResource } from '../../lib/authorization.js';
import { toLimitOffset, toPageMeta } from '../../lib/pagination.js';
import { config } from '../../config/env.js';

function notFound() {
  return new NotFoundError('Commission not found', { code: 'COMMISSION_NOT_FOUND' });
}

/**
 * A client submits a commission request. It starts at `inquiry`, and the creation is
 * recorded as the first event, both in one transaction. Prices are never read from the
 * request: the validation schema strips any price fields, and quotes are computed later
 * on the server.
 */
export async function createCommission(user, input) {
  await pricingService.assertOffered(input);

  return withTransaction(async (client) => {
    const commission = await commissionsRepository.insert(
      { ...input, clientId: user.id, revisionLimit: config.commissionRevisionLimit },
      client,
    );
    await commissionsRepository.insertEvent(
      {
        commissionId: commission.id,
        fromStatus: null,
        toStatus: commission.status,
        actorType: 'client',
        actorUserId: user.id,
        reason: 'Commission requested',
      },
      client,
    );
    return commission;
  });
}

/**
 * Loads and locks a commission inside the caller's transaction, so other modules
 * (quotes, later payments) can read it and act on it without a concurrent change slipping in.
 */
export async function lockCommission(id, client) {
  const commission = await commissionsRepository.findById(id, client, { forUpdate: true });
  if (!commission) throw notFound();
  return commission;
}

/** Loads a commission the user may see (their own, or any for an admin). */
export async function getCommissionForUser(id, user) {
  const commission = await commissionsRepository.findById(id);
  if (!commission) throw notFound();
  assertCanAccessOwnedResource(user, commission.clientId);
  return commission;
}

/** The commission plus the status changes this user can make right now (for the UI). */
export async function getCommissionDetails(id, user) {
  const commission = await getCommissionForUser(id, user);
  return {
    ...commission,
    availableTransitions: availableTransitions(commission, actorFromUser(user)),
  };
}

/** Clients see only their own commissions; admins see all. Both can filter by status. */
export async function listCommissions(user, { page, pageSize, status }) {
  const clientId = user.role === 'admin' ? undefined : user.id;
  const { commissions, total } = await commissionsRepository.list({
    clientId,
    status,
    ...toLimitOffset({ page, pageSize }),
  });
  return { commissions, meta: toPageMeta({ page, pageSize }, total) };
}

export async function listEvents(id, user) {
  await getCommissionForUser(id, user);
  return commissionsRepository.listEvents(id);
}

/** A user changes a commission's status through the generic endpoint. */
export async function changeStatus(id, user, { toStatus, reason }) {
  await getCommissionForUser(id, user); // 404 / 403 before revealing anything else
  return applyTransition({ commissionId: id, toStatus, actor: actorFromUser(user), reason });
}

/** Not paid for yet: cancelled automatically when the client deletes their account. */
export const CANCELLABLE_ON_DELETION = Object.freeze(['inquiry', 'quoted']);
/** Nothing left to do or pay: they stay, anonymized, for the owner's records. */
export const FINISHED_STATUSES = Object.freeze(['delivered', 'completed', 'canceled', 'refunded']);

/**
 * Account deletion, step 1 (inside the caller's transaction): a client can't delete their
 * account while a paid commission is still in progress, because the artist owes them work
 * or money is still moving. Unpaid requests are cancelled through applyTransition, and the
 * free-text notes are cleared. Returns the commissions it cancelled, so the caller can run
 * the after-cancel step (closing open Stripe pages) once the transaction has committed.
 *
 * @param {number} clientId
 * @param {{ client: import('pg').PoolClient }} options
 */
export async function closeForDeletedClient(clientId, { client }) {
  const commissions = await commissionsRepository.listForClientForUpdate(clientId, client);
  const active = commissions.filter(
    (c) => !CANCELLABLE_ON_DELETION.includes(c.status) && !FINISHED_STATUSES.includes(c.status),
  );
  if (active.length > 0) {
    throw new BusinessRuleError(
      'This account has a commission in progress. Finish or cancel it before deleting the account.',
      { code: 'ACTIVE_COMMISSIONS', details: { commissionIds: active.map((c) => c.id) } },
    );
  }

  const canceled = [];
  for (const commission of commissions.filter((c) => CANCELLABLE_ON_DELETION.includes(c.status))) {
    canceled.push(
      await applyTransition(
        {
          commissionId: commission.id,
          toStatus: 'canceled',
          actor: { type: 'client', userId: clientId },
          reason: 'Account deleted',
        },
        { client },
      ),
    );
  }
  await commissionsRepository.clearNotesForClient(clientId, client);
  return canceled;
}

/**
 * The one place a commission's status changes. In a single transaction:
 *   1. lock the commission row (concurrent changes queue instead of racing),
 *   2. check the state machine (who, from where, guards),
 *   3. update the commission (status, effects, and any `extraChanges`),
 *   4. append the commission_events row.
 * If any step fails, everything rolls back: status and history never disagree.
 *
 * Pass `client` to join a transaction the caller already opened (the quote flow and
 * the Stripe webhook do this so their own writes commit or roll back together with it).
 *
 * @param {{
 *   commissionId: number,
 *   toStatus: string,
 *   actor: import('./commissions.stateMachine.ts').Actor,
 *   via?: import('./commissions.stateMachine.ts').TransitionFlow,
 *   reason?: string,
 *   metadata?: Record<string, unknown>,
 *   extraChanges?: Record<string, unknown>,
 * }} transition
 * @param {{ client?: import('pg').PoolClient }} [options]
 */
export async function applyTransition(
  { commissionId, toStatus, actor, via, reason, metadata, extraChanges = {} },
  { client } = {},
) {
  const run = async (tx) => {
    const commission = await commissionsRepository.findById(commissionId, tx, { forUpdate: true });
    if (!commission) throw notFound();

    const { changes } = assertTransition(commission, toStatus, actor, { via });
    const updated = await commissionsRepository.update(
      commissionId,
      { ...extraChanges, ...changes },
      tx,
    );

    await commissionsRepository.insertEvent(
      {
        commissionId,
        fromStatus: commission.status,
        toStatus,
        actorType: actor.type,
        actorUserId: actor.type === 'system' ? null : actor.userId,
        reason,
        metadata,
      },
      tx,
    );
    return updated;
  };

  return client ? run(client) : withTransaction(run);
}

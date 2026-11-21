import * as commissionsRepository from './commissions.repository.js';
import * as pricingService from '../pricing/pricing.service.js';
import {
  actorFromUser,
  assertTransition,
  availableTransitions,
} from './commissions.stateMachine.js';
import { withTransaction } from '../../db/transaction.js';
import { NotFoundError } from '../../errors/index.js';
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

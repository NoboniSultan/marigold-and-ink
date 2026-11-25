/**
 * Stripe webhooks: Stripe tells us a payment or refund happened.
 *
 * - The signature is checked first; anything not signed by Stripe is refused.
 * - Each event is handled in one transaction that first records its ID in
 *   processed_webhook_events. A duplicate delivery finds the ID already there and does
 *   nothing. If handling fails, everything (including that record) rolls back, the
 *   endpoint answers 500, and Stripe retries later.
 * - Every handler locks the commission before touching its payments, like the request
 *   flows, so a webhook and a request for the same commission never interleave.
 */
import type { PoolClient } from 'pg';
import { withTransaction } from '../../db/transaction.ts';
import { logger } from '../../lib/logger.js';
import type {
  PaymentEvent,
  PaymentGateway,
  RefundInfo,
} from '../../adapters/stripe/stripeGateway.ts';
import * as commissionsService from '../commissions/commissions.service.js';
import * as givingService from '../giving/giving.service.ts';
import { SYSTEM_ACTOR } from '../commissions/commissions.stateMachine.ts';
import * as paymentsRepository from './payments.repository.ts';
import { requireGateway, settleRefunds } from './payments.service.ts';

type CompletedSession = Extract<PaymentEvent, { type: 'checkout.completed' }>['session'];

/** Verifies and handles one webhook delivery. Returns whether it was a duplicate. */
export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  gatewayOrNull: PaymentGateway | null,
  { donationPercent = null }: { donationPercent?: number | null } = {},
): Promise<{ duplicate: boolean }> {
  const { gateway } = requireGateway(gatewayOrNull);
  const event = gateway.parseWebhook(rawBody, signature); // throws WebhookSignatureError

  return withTransaction(async (tx) => {
    const fresh = await paymentsRepository.recordProcessedEvent(event.id, event.stripeType, tx);
    if (!fresh) {
      logger.info({ eventId: event.id, type: event.stripeType }, 'duplicate Stripe event ignored');
      return { duplicate: true };
    }
    switch (event.type) {
      case 'checkout.completed':
        await onCheckoutCompleted(event.session, gateway, donationPercent, tx);
        break;
      case 'checkout.expired':
        await onCheckoutExpired(event.session.id, tx);
        break;
      case 'refund.changed':
        await onRefundChanged(event.refund, tx);
        break;
      case 'ignored':
        break;
    }
    return { duplicate: false };
  });
}

/**
 * The client paid. Record it, then move the commission on: deposit → deposit_paid; final →
 * ready_to_ship (physical) or delivered (digital and mixed media, delivered as files). If
 * the commission is no longer waiting for this payment (it was cancelled while the Stripe
 * page was open), the money is refunded automatically and the status is left alone.
 */
async function onCheckoutCompleted(
  session: CompletedSession,
  gateway: PaymentGateway,
  donationPercent: number | null,
  tx: PoolClient,
) {
  const found = await paymentsRepository.findBySessionId(session.id, tx);
  if (!found) {
    logger.warn({ sessionId: session.id }, 'Checkout session not created by this app; ignored');
    return;
  }
  if (!session.paid || !session.paymentIntentId) {
    // Cards settle at once, so this shouldn't happen; never record unpaid money as paid.
    logger.warn({ sessionId: session.id }, 'Checkout completed without payment; ignored');
    return;
  }

  const commission = await commissionsService.lockCommission(found.commissionId, tx);
  const payment = (await paymentsRepository.findById(found.id, tx))!; // re-read under the lock
  if (payment.status === 'succeeded') return;
  if (session.amountCents !== payment.amountCents || session.currency !== payment.currency) {
    logger.error(
      { sessionId: session.id, paymentId: payment.id },
      'Stripe amount differs from the recorded payment',
    );
  }
  await paymentsRepository.markSucceeded(payment.id, session.paymentIntentId, tx);

  const waitingFor = payment.type === 'deposit' ? 'quoted' : 'awaiting_final_payment';
  if (commission.status === waitingFor) {
    const toStatus =
      payment.type === 'deposit'
        ? 'deposit_paid'
        : commission.fulfillmentType === 'physical'
          ? 'ready_to_ship'
          : 'delivered';
    await commissionsService.applyTransition(
      {
        commissionId: commission.id,
        toStatus,
        actor: SYSTEM_ACTOR,
        reason: payment.type === 'deposit' ? 'Deposit paid' : 'Final payment received',
        metadata: { paymentId: payment.id, amountCents: payment.amountCents },
      },
      { client: tx },
    );
    if (payment.type === 'final' && commission.quotedTotalCents !== null) {
      // Fully paid: record the trees now, in this transaction. They're sent to Digital
      // Humani after the commit (requestPendingTrees), so an outage there can't fail this.
      await givingService.recordForFinalPayment(
        {
          commissionId: commission.id,
          paymentId: payment.id,
          totalCents: commission.quotedTotalCents,
        },
        { client: tx, donationPercent },
      );
    }
    return;
  }

  // Paid at the wrong time: give the money back. The key is tied to the session, so if this
  // transaction rolls back and Stripe retries the event, Stripe returns the same refund
  // instead of refunding twice.
  const refund = await gateway.createRefund(
    {
      paymentIntentId: session.paymentIntentId,
      amountCents: payment.amountCents,
      refundPaymentId: null,
      commissionId: commission.id,
    },
    { idempotencyKey: `auto-refund-${session.id}` },
  );
  await paymentsRepository.insertRefund(
    {
      commissionId: commission.id,
      refundedPaymentId: payment.id,
      amountCents: payment.amountCents,
      currency: payment.currency,
      paymentIntentId: session.paymentIntentId,
      stripeRefundId: refund.id,
      status: refund.status,
      reason: `Paid while the commission was ${commission.status.replaceAll('_', ' ')}; refunded automatically`,
      requestedByUserId: null,
    },
    tx,
  );
  logger.warn(
    { commissionId: commission.id, paymentId: payment.id, status: commission.status },
    'payment arrived for a commission no longer waiting for it; refunded automatically',
  );
}

async function onCheckoutExpired(sessionId: string, tx: PoolClient) {
  const payment = await paymentsRepository.findBySessionId(sessionId, tx);
  if (payment) await paymentsRepository.markExpired(payment.id, tx);
}

/**
 * The site never refunds tree money (ADR 0013), but a refund made in the Stripe Dashboard
 * can't be stopped. When one reaches into it, say so loudly: those trees are on order and
 * still owed to the planting partner, so the owner pays for them out of pocket.
 */
async function warnIfTreeMoneyRefunded(commissionId: number, tx: PoolClient) {
  const withheldForTreesCents = await givingService.withheldForTreesCents(commissionId, {
    client: tx,
  });
  if (withheldForTreesCents === 0) return;
  const { paidCents, refundedOrPendingCents } = await paymentsRepository.commissionRefundPosition(
    commissionId,
    tx,
  );
  if (refundedOrPendingCents > paidCents - withheldForTreesCents) {
    logger.warn(
      { commissionId, paidCents, refundedCents: refundedOrPendingCents, withheldForTreesCents },
      'a Stripe Dashboard refund gave back tree money; those trees are on order and still owed',
    );
  }
}

/**
 * A refund was created or changed: by this app (already recorded; update its status), or
 * directly in the Stripe Dashboard (record it now). Once everything paid is refunded, the
 * commission becomes `refunded` where the state machine allows it.
 */
async function onRefundChanged(refund: RefundInfo, tx: PoolClient) {
  const original = refund.paymentIntentId
    ? await paymentsRepository.findIncomingByIntent(refund.paymentIntentId, tx)
    : null;
  if (!original) {
    logger.warn({ refundId: refund.id }, 'refund for a payment not made through this app; ignored');
    return;
  }
  await commissionsService.lockCommission(original.commissionId, tx);

  let row = await paymentsRepository.findRefundByStripeId(refund.id, tx);
  if (!row) {
    row = await paymentsRepository.insertRefund(
      {
        commissionId: original.commissionId,
        refundedPaymentId: original.id,
        amountCents: refund.amountCents,
        currency: refund.currency,
        paymentIntentId: refund.paymentIntentId,
        stripeRefundId: refund.id,
        status: refund.status,
        reason: 'Refunded in the Stripe Dashboard',
        requestedByUserId: null,
      },
      tx,
    );
    await warnIfTreeMoneyRefunded(original.commissionId, tx);
  } else if (row.status !== refund.status) {
    row = await paymentsRepository.updateRefund(
      row.id,
      { stripeRefundId: refund.id, status: refund.status },
      tx,
    );
  }

  if (row.status === 'succeeded') {
    const actor = row.requestedByUserId
      ? ({ type: 'admin', userId: row.requestedByUserId } as const)
      : SYSTEM_ACTOR;
    await settleRefunds(original.commissionId, actor, tx);
  }
}

/**
 * Taking and returning money for commissions, through Stripe Checkout.
 *
 * Every flow runs in one transaction that starts by locking the commission row, so two
 * requests (or a request and a webhook) for the same commission never interleave. The
 * Stripe call happens inside that transaction, with an idempotency key derived from the
 * payment row: if anything fails, nothing is recorded, and a retry either gets a fresh row
 * (and key) or, for the webhook, the same key and therefore the same Stripe result.
 *
 * Amounts always come from the stored quote (commission.depositCents / balanceCents),
 * never from the request.
 */
import { config } from '../../config/env.js';
import { withTransaction } from '../../db/transaction.ts';
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../errors/index.js';
import { assertCanAccessOwnedResource } from '../../lib/authorization.js';
import { logger } from '../../lib/logger.js';
import {
  PaymentGatewayError,
  type IncomingPaymentType,
  type PaymentGateway,
} from '../../adapters/stripe/stripeGateway.ts';
import * as commissionsService from '../commissions/commissions.service.js';
import { refundableCents } from '../giving/giving.calculator.ts';
import * as givingService from '../giving/giving.service.ts';
import { canTransition, type Actor } from '../commissions/commissions.stateMachine.ts';
import * as paymentsRepository from './payments.repository.ts';
import type { PaymentRecord } from './payments.repository.ts';
import type { PoolClient } from 'pg';

/** How long a Stripe Checkout page stays payable (Stripe allows 30 minutes to 24 hours). */
export const CHECKOUT_TTL_MINUTES = 60;
/** An open page is only reused if it still has this long left, so it can't expire mid-payment. */
const REUSE_MARGIN_MS = 10 * 60_000;

interface SessionUser {
  id: number;
  email: string;
  role: 'client' | 'admin';
}

/** What a commission has to be in for each payment, and where it goes once paid. */
const STAGES = {
  deposit: { from: 'quoted', amount: 'depositCents', label: 'Deposit' },
  final: { from: 'awaiting_final_payment', amount: 'balanceCents', label: 'Balance' },
} as const;

/** The gateway and currency, or 503 when payments aren't configured. */
export function requireGateway(gateway: PaymentGateway | null) {
  if (!gateway || !config.stripe) {
    throw new ServiceUnavailableError("Online payment isn't available yet.", {
      code: 'PAYMENTS_UNAVAILABLE',
    });
  }
  return { gateway, currency: config.stripe.currency as string };
}

/** Stripe failed or didn't answer: a 502 with a message that's safe to show. */
async function viaGateway<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof PaymentGatewayError)) throw err;
    logger.error({ err }, 'payment provider error');
    throw new AppError("The payment service couldn't be reached. Please try again.", {
      status: 502,
      code: 'PAYMENT_PROVIDER_ERROR',
    });
  }
}

/**
 * Starts (or resumes) paying the deposit or the balance: returns the Stripe Checkout URL.
 * Only the commission's own client may pay, and only at the right stage. A second click
 * while a page is still open gets that same page back instead of a new one.
 */
export async function startCheckout(
  commissionId: number,
  user: SessionUser,
  type: IncomingPaymentType,
  gatewayOrNull: PaymentGateway | null,
): Promise<{ url: string; expiresAt: Date; reused: boolean }> {
  const { gateway, currency } = requireGateway(gatewayOrNull);
  const stage = STAGES[type];

  return withTransaction(async (tx) => {
    const commission = await commissionsService.lockCommission(commissionId, tx);
    assertCanAccessOwnedResource(user, commission.clientId); // 403 for other clients
    if (commission.clientId !== user.id) {
      throw new ForbiddenError("Only the commission's client can pay for it", {
        code: 'PAYMENT_CLIENT_ONLY',
      });
    }
    if (commission.status !== stage.from) {
      throw new ConflictError(
        `The ${stage.label.toLowerCase()} can only be paid while the commission is ${stage.from.replaceAll('_', ' ')}`,
        { code: 'PAYMENT_NOT_ALLOWED', details: { status: commission.status, type } },
      );
    }
    const amountCents: number | null = commission[stage.amount];
    if (!amountCents || amountCents <= 0) {
      throw new BusinessRuleError(`There is no ${stage.label.toLowerCase()} to pay`, {
        code: 'NOTHING_TO_PAY',
      });
    }

    const open = await paymentsRepository.findOpenCheckout(
      commissionId,
      type,
      new Date(Date.now() + REUSE_MARGIN_MS),
      tx,
    );
    if (open?.checkoutUrl && open.checkoutExpiresAt) {
      return { url: open.checkoutUrl, expiresAt: open.checkoutExpiresAt, reused: true };
    }

    const payment = await paymentsRepository.insertIncoming(
      { commissionId, type, amountCents, currency },
      tx,
    );
    const returnTo = `${config.publicUrl}/commissions/${commissionId}`;
    const session = await viaGateway(() =>
      gateway.createCheckoutSession(
        {
          paymentId: payment.id,
          commissionId,
          type,
          amountCents,
          currency,
          description: `${stage.label} for commission #${commissionId}`,
          customerEmail: user.email,
          successUrl: `${returnTo}?payment=success`,
          cancelUrl: `${returnTo}?payment=cancelled`,
          expiresAt: new Date(Date.now() + CHECKOUT_TTL_MINUTES * 60_000),
        },
        { idempotencyKey: `checkout-payment-${payment.id}` },
      ),
    );
    await paymentsRepository.setCheckout(
      payment.id,
      { sessionId: session.id, url: session.url, expiresAt: session.expiresAt },
      tx,
    );
    return { url: session.url, expiresAt: session.expiresAt, reused: false };
  });
}

/** Payments for a commission (owner or admin). Clients don't see refund notes or who asked. */
export async function listPayments(commissionId: number, user: SessionUser) {
  await commissionsService.getCommissionForUser(commissionId, user); // 404 / 403
  const payments = await paymentsRepository.listForCommission(commissionId);
  return payments.map((p) => toPublicPayment(p, user.role === 'admin'));
}

export function toPublicPayment(payment: PaymentRecord, forAdmin: boolean) {
  return {
    id: payment.id,
    type: payment.type,
    amountCents: payment.amountCents,
    currency: payment.currency,
    status: payment.status,
    refundedPaymentId: payment.refundedPaymentId,
    createdAt: payment.createdAt,
    ...(forAdmin ? { reason: payment.reason, requestedByUserId: payment.requestedByUserId } : {}),
  };
}

/**
 * If everything paid has now been refunded, the commission ends as `refunded` (only from
 * the statuses where the state machine allows it). Partial refunds, and refunds after the
 * final payment, move money without changing the status.
 */
export async function settleRefunds(commissionId: number, actor: Actor, tx: PoolClient) {
  const commission = await commissionsService.lockCommission(commissionId, tx);
  const { paidCents, refundedCents } = await paymentsRepository.totals(commissionId, tx);
  if (paidCents === 0 || refundedCents < paidCents) return;
  if (!canTransition(commission, 'refunded', actor, { via: 'refund' }).allowed) return;
  await commissionsService.applyTransition(
    {
      commissionId,
      toStatus: 'refunded',
      actor,
      via: 'refund',
      reason: 'Fully refunded',
      metadata: { paidCents, refundedCents },
    },
    { client: tx },
  );
}

/**
 * An admin refunds a deposit or final payment, fully (no amount) or partly. The refund is
 * recorded as pending, sent to Stripe, then updated with Stripe's answer; a refund Stripe
 * confirms later arrives through the webhook.
 */
export async function refund(
  commissionId: number,
  admin: SessionUser,
  {
    paymentId,
    amountCents,
    reason,
  }: { paymentId: number; amountCents?: number | undefined; reason: string },
  gatewayOrNull: PaymentGateway | null,
) {
  const { gateway } = requireGateway(gatewayOrNull);

  return withTransaction(async (tx) => {
    await commissionsService.lockCommission(commissionId, tx);
    const payment = await paymentsRepository.findById(paymentId, tx);
    if (!payment || payment.commissionId !== commissionId || payment.type === 'refund') {
      throw new NotFoundError('Payment not found', { code: 'PAYMENT_NOT_FOUND' });
    }
    if (payment.status !== 'succeeded' || !payment.stripePaymentIntentId) {
      throw new BusinessRuleError('Only a completed payment can be refunded', {
        code: 'PAYMENT_NOT_REFUNDABLE',
      });
    }

    const paymentRemaining =
      payment.amountCents - (await paymentsRepository.refundedOrPendingCents(paymentId, tx));
    // Tree money is never refunded: once a commission is fully paid, its trees are recorded
    // and can't be un-requested (ADR 0013), so the whole commission's refunds stop short of it.
    const withheldForTreesCents = await givingService.withheldForTreesCents(commissionId, {
      client: tx,
    });
    let remaining = paymentRemaining;
    if (withheldForTreesCents > 0) {
      const position = await paymentsRepository.commissionRefundPosition(commissionId, tx);
      remaining = Math.min(
        paymentRemaining,
        refundableCents({
          paidCents: position.paidCents,
          refundedCents: position.refundedOrPendingCents,
          withheldForTreesCents,
        }),
      );
    }
    const trees = withheldForTreesCents > 0 ? { withheldForTreesCents } : {};
    if (remaining <= 0) {
      throw new BusinessRuleError(
        withheldForTreesCents > 0 && paymentRemaining > 0
          ? 'Everything else has been refunded; the rest went to planting trees'
          : 'This payment has already been refunded in full',
        { code: 'ALREADY_REFUNDED', details: { remainingCents: 0, ...trees } },
      );
    }
    const amount = amountCents ?? remaining;
    if (amount > remaining) {
      throw new BusinessRuleError(
        withheldForTreesCents > 0
          ? `At most ${remaining} cents can be refunded; ${withheldForTreesCents} cents went to planting trees`
          : `At most ${remaining} cents of this payment can be refunded`,
        { code: 'REFUND_EXCEEDS_PAYMENT', details: { remainingCents: remaining, ...trees } },
      );
    }

    const row = await paymentsRepository.insertRefund(
      {
        commissionId,
        refundedPaymentId: payment.id,
        amountCents: amount,
        currency: payment.currency,
        paymentIntentId: payment.stripePaymentIntentId,
        stripeRefundId: null,
        status: 'pending',
        reason,
        requestedByUserId: admin.id,
      },
      tx,
    );
    const result = await viaGateway(() =>
      gateway.createRefund(
        {
          paymentIntentId: payment.stripePaymentIntentId!,
          amountCents: amount,
          refundPaymentId: row.id,
          commissionId,
        },
        { idempotencyKey: `refund-payment-${row.id}` },
      ),
    );
    const updated = await paymentsRepository.updateRefund(
      row.id,
      { stripeRefundId: result.id, status: result.status },
      tx,
    );
    if (updated.status === 'succeeded') {
      await settleRefunds(commissionId, { type: 'admin', userId: admin.id }, tx);
    }
    return toPublicPayment(updated, true);
  });
}

/**
 * When a commission is cancelled, close its open Checkout pages so they can't be paid.
 * Best effort: if Stripe can't be reached, a payment that still arrives is refunded
 * automatically by the webhook.
 */
export async function expireOpenCheckouts(commissionId: number, gateway: PaymentGateway | null) {
  if (!gateway) return;
  const open = await paymentsRepository.listOpenCheckouts(commissionId);
  for (const payment of open) {
    try {
      await gateway.expireCheckoutSession(payment.stripeCheckoutSessionId!);
      await paymentsRepository.markExpired(payment.id);
    } catch (err) {
      logger.warn(
        { err, paymentId: payment.id, commissionId },
        'could not expire a Checkout session after cancelling',
      );
    }
  }
}

// --- The admin screens (milestone 9) ---

/**
 * Where a commission's money stands, for its admin page and refund form: paid in, given
 * back (succeeded or still processing), held back for trees (never refunded, ADR 0013),
 * and what can still be refunded. `treeMoneyRefundedCents` is above 0 only if a refund made
 * in the Stripe Dashboard reached into the tree money.
 */
export async function moneySummary(commissionId: number) {
  const [{ paidCents, refundedOrPendingCents }, trees] = await Promise.all([
    paymentsRepository.commissionRefundPosition(commissionId),
    givingService.treeSummary(commissionId),
  ]);
  const keptCents = paidCents - trees.withheldForTreesCents;
  return {
    paidCents,
    refundedCents: refundedOrPendingCents,
    withheldForTreesCents: trees.withheldForTreesCents,
    refundableCents: Math.max(0, keptCents - refundedOrPendingCents),
    treeMoneyRefundedCents: Math.max(0, refundedOrPendingCents - keptCents),
    trees: trees.trees,
  };
}

export function monthlyPayments(year: number, timeZone: string) {
  return paymentsRepository.monthlyPayments(year, timeZone);
}

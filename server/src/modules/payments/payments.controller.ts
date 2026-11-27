import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { PaymentsMeta } from '@shared/types/payment.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import { WebhookSignatureError } from '../../adapters/stripe/stripeGateway.ts';
import { config } from '../../config/env.js';
import { ValidationError } from '../../errors/index.js';
import * as paymentsService from './payments.service.ts';
import { handleStripeWebhook } from './payments.webhooks.ts';
import type { checkoutParams, commissionParams, refundBody } from './payments.validation.ts';

const gateway = (req: Request) => (req.app.locals.adapters as AppAdapters).payments;
const sessionUser = (req: Request) => req.user!;

/** POST /commissions/:id/payments/:type: the Stripe Checkout URL to send the client to. */
export async function startCheckout(req: Request, res: Response) {
  const { id, type } = req.validated.params as z.infer<typeof checkoutParams>;
  const result = await paymentsService.startCheckout(
    id,
    sessionUser(req),
    type,
    gateway(req),
    (req.app.locals.adapters as AppAdapters).shipping ?? null,
  );
  res.status(result.reused ? 200 : 201).json({ data: result });
}

/** GET /commissions/:id/payments, plus whether paying online is switched on. */
export async function list(req: Request, res: Response) {
  const { id } = req.validated.params as z.infer<typeof commissionParams>;
  const payments = await paymentsService.listPayments(id, sessionUser(req));
  res.json({
    data: payments,
    meta: {
      paymentsEnabled: gateway(req) !== null && config.stripe !== null,
      currency: config.paymentCurrency,
    },
  } satisfies { data: unknown[]; meta: PaymentsMeta });
}

/** POST /admin/commissions/:id/refunds */
export async function refund(req: Request, res: Response) {
  const { id } = req.validated.params as z.infer<typeof commissionParams>;
  const body = req.validated.body as z.infer<typeof refundBody>;
  const result = await paymentsService.refund(id, sessionUser(req), body, gateway(req));
  res.status(201).json({ data: result });
}

/**
 * POST /webhooks/stripe. Mounted with the raw body (the signature covers the exact bytes).
 * 200 tells Stripe the event is handled (or was a duplicate); an error status makes it retry.
 */
export async function stripeWebhook(req: Request, res: Response) {
  try {
    const { duplicate } = await handleStripeWebhook(
      req.body as Buffer,
      req.get('stripe-signature'),
      gateway(req),
      { donationPercent: req.app.locals.donationPercent ?? null },
    );
    // Send any trees this payment funded. Not awaited: Stripe gets its answer at once, and
    // a Digital Humani problem leaves the trees pending for the next try (never throws).
    if (!duplicate) void req.app.locals.requestPendingTrees?.();
    res.json({ received: true, duplicate });
  } catch (err) {
    if (err instanceof WebhookSignatureError) {
      throw new ValidationError('Invalid webhook signature', { code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
    throw err;
  }
}

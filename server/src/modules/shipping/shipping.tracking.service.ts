/**
 * Tracking (milestone 11b, ADR 0017). Shippo's webhook only says "this tracking number
 * changed": the app then asks Shippo itself, with its own token, and trusts only that
 * answer. A daily check does the same for every package still on its way, in case a
 * webhook was missed.
 *
 * From the answer: the scans are saved, the commission moves to shipped at the carrier's
 * first scan and to delivered on delivery (as the system), the client is emailed for each,
 * and the owner is emailed once if the package is returned or can't be delivered.
 */
import { timingSafeEqual, createHash } from 'node:crypto';
import type { EmailMessage, EmailSender } from '../../adapters/email.ts';
import type { ShippingSetup } from '../../adapters/shippo.ts';
import { config } from '../../config/env.js';
import { withTransaction } from '../../db/transaction.ts';
import { NotFoundError, UnauthorizedError } from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import * as commissionsService from '../commissions/commissions.service.js';
import { SYSTEM_ACTOR } from '../commissions/commissions.stateMachine.ts';
import * as usersService from '../users/users.service.ts';
import * as labelsRepository from './shipping.labels.repository.ts';
import type { LabelRecord } from './shipping.labels.repository.ts';
import {
  deliveredEmail,
  deliveryProblemEmail,
  hasPlaceholder,
  shippedEmail,
  type PackageFacts,
} from './shipping.emails.ts';
import {
  TRACKED_STATUSES,
  isDeliveryProblem,
  ships,
  trackingCarrier,
  trackingMoves,
} from './shipping.rules.ts';
import { requireShipping, viaProvider, type Setup } from './shipping.guards.ts';

type Email = EmailSender | null | undefined;

// --- Emails (sent after the change is saved; a failure is logged, never thrown) ---

const siteUrl = () => config.publicUrl ?? '';

async function sendSafely(email: Email, message: EmailMessage, context: Record<string, unknown>) {
  if (!email) return;
  // The owner's wording isn't written yet: never send placeholder text to a real person.
  if (config.nodeEnv === 'production' && hasPlaceholder(message)) {
    logger.warn(context, 'shipping email not sent: its wording is still a placeholder');
    return;
  }
  try {
    await email.send(message);
  } catch (err) {
    logger.error({ err, ...context }, 'shipping email failed');
  }
}

function factsFor(label: LabelRecord | null, commissionId: number): PackageFacts | null {
  if (!label) return null;
  return {
    carrier: label.carrier,
    serviceName: label.serviceName,
    trackingNumber: label.trackingNumber,
    trackingUrl: label.trackingUrl,
    pageUrl: `${siteUrl()}/commissions/${commissionId}`,
  };
}

/**
 * Emails the client that their package shipped or was delivered. Runs after any such
 * change: from tracking, or the owner marking it by hand (then there may be no label).
 */
export async function notifyStatusChange(
  commission: { id: number; status: string; clientId: number; fulfillmentType: string },
  email: Email,
): Promise<void> {
  if (!email || !ships(commission.fulfillmentType)) return;
  if (commission.status !== 'shipped' && commission.status !== 'delivered') return;
  const client = await usersService.findById(commission.clientId);
  if (!client) return; // the account was deleted
  const labels = await labelsRepository.listForCommission(commission.id);
  const label = labels.find((l) => l.voidedAt === null) ?? null;
  const pageUrl = `${siteUrl()}/commissions/${commission.id}`;
  const facts = factsFor(label, commission.id);
  const message =
    commission.status === 'shipped'
      ? shippedEmail(client.email, facts, pageUrl)
      : deliveredEmail(client.email, facts, pageUrl);
  await sendSafely(email, message, { commissionId: commission.id, status: commission.status });
}

async function notifyProblem(label: LabelRecord, email: Email) {
  const admins = await usersService.findAdmins();
  for (const admin of admins) {
    await sendSafely(
      email,
      deliveryProblemEmail(admin.email, {
        commissionId: label.commissionId,
        trackingNumber: label.trackingNumber,
        status: label.trackingStatus as 'returned' | 'failure',
        details: label.trackingDetails,
        adminUrl: `${siteUrl()}/admin/commissions/${label.commissionId}`,
      }),
      { commissionId: label.commissionId, alert: 'delivery problem' },
    );
  }
}

// --- Reading tracking from the shipping service ---

const REASONS = {
  shipped: 'The carrier scanned the package',
  delivered: 'The carrier delivered the package',
} as const;

/**
 * Asks the shipping service where one label's package is and applies the answer. Throws
 * if the shipping service can't be reached (the webhook then answers 5xx and is retried).
 */
export async function refreshLabel(
  labelId: number,
  { shipping, email }: { shipping: ShippingSetup; email: Email },
): Promise<void> {
  const label = await labelsRepository.findById(labelId);
  if (!label || label.voidedAt) return;
  const info = await shipping.provider.track(trackingCarrier(label.carrier), label.trackingNumber);

  const outcome = await withTransaction(async (tx) => {
    const commission = await commissionsService.lockCommission(label.commissionId, tx);
    const current = await labelsRepository.findById(labelId, tx);
    if (!current || current.voidedAt) return null; // voided meanwhile
    await labelsRepository.insertEvents(labelId, info.scans, tx);
    await labelsRepository.updateTracking(labelId, info, tx);

    // Emailed about only once this commits: never for a change that then rolls back.
    const moved: Parameters<typeof notifyStatusChange>[0][] = [];
    for (const toStatus of trackingMoves(commission.status, info.status)) {
      const updated = await commissionsService.applyTransition(
        {
          commissionId: commission.id,
          toStatus,
          actor: SYSTEM_ACTOR,
          reason: REASONS[toStatus],
          metadata: { trackingNumber: label.trackingNumber, trackingStatus: info.status },
        },
        { client: tx },
      );
      if (updated) moved.push(updated);
    }
    const alert =
      isDeliveryProblem(info.status) && (await labelsRepository.markProblemNotified(labelId, tx));
    return { moved, alert };
  });
  if (!outcome) return;

  for (const commission of outcome.moved) await notifyStatusChange(commission, email);
  if (outcome.alert) {
    await notifyProblem(
      { ...label, trackingStatus: info.status, trackingDetails: info.details },
      email,
    );
  }
}

// --- The webhook ---

function sameSecret(given: string, expected: string): boolean {
  // Hashing first gives equal lengths, so the comparison takes the same time either way.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Checks the webhook link's secret. 404 while the webhook is off; 401 for a wrong one. */
export function checkWebhookToken(token: string | undefined, shipping: Setup): ShippingSetup {
  if (!shipping?.webhookToken) {
    throw new NotFoundError('Not found', { code: 'NOT_FOUND' });
  }
  if (!token || !sameSecret(token, shipping.webhookToken)) {
    throw new UnauthorizedError('Invalid webhook link', { code: 'WEBHOOK_TOKEN_INVALID' });
  }
  return shipping;
}

/**
 * A tracking webhook: only its tracking number is used, to find the label; everything
 * else is read from the shipping service. Unknown numbers and other events are ignored.
 */
export async function handleWebhook(
  body: { event: string; data?: { tracking_number?: string } | null },
  { shipping, email }: { shipping: Setup; email: Email },
): Promise<{ handled: boolean }> {
  const setup = requireShipping(shipping);
  const trackingNumber = body.data?.tracking_number;
  if (body.event !== 'track_updated' || !trackingNumber) return { handled: false };
  const labels = await labelsRepository.findActiveByTrackingNumber(trackingNumber);
  for (const label of labels) {
    // A 502 when Shippo can't answer: Shippo then sends the webhook again.
    await viaProvider(() => refreshLabel(label.id, { shipping: setup, email }));
  }
  return { handled: labels.length > 0 };
}

// --- The daily check ---

/**
 * Refreshes every package still on its way, and the refunds of voided labels. Never
 * throws: one failure is logged and the rest carry on.
 */
export async function refreshAllTracking({
  shipping,
  email,
}: {
  shipping: Setup;
  email: Email;
}): Promise<{ labels: number; refunds: number; failed: number }> {
  const result = { labels: 0, refunds: 0, failed: 0 };
  if (!shipping) return result;
  try {
    for (const label of await labelsRepository.findToTrack(TRACKED_STATUSES)) {
      try {
        await refreshLabel(label.id, { shipping, email });
        result.labels += 1;
      } catch (err) {
        result.failed += 1;
        logger.error({ err, labelId: label.id }, 'tracking check failed');
      }
    }
    for (const label of await labelsRepository.findPendingRefunds()) {
      try {
        const refund = await shipping.provider.getRefund(label.refundId!);
        if (refund.status !== label.refundStatus) {
          await labelsRepository.setRefundStatus(label.id, refund.status);
        }
        result.refunds += 1;
      } catch (err) {
        result.failed += 1;
        logger.error({ err, labelId: label.id }, 'refund check failed');
      }
    }
  } catch (err) {
    logger.error({ err }, 'tracking check failed');
  }
  if (result.labels + result.refunds + result.failed > 0) {
    logger.info(result, 'tracking checked');
  }
  return result;
}

/** The owner's "check tracking now": refreshes the label in use right away. */
export async function refreshCommission(
  commissionId: number,
  { shipping, email }: { shipping: Setup; email: Email },
): Promise<void> {
  const setup = requireShipping(shipping);
  const labels = await labelsRepository.listForCommission(commissionId);
  const label = labels.find((l) => l.voidedAt === null);
  if (!label) throw new NotFoundError('This commission has no label', { code: 'LABEL_NOT_FOUND' });
  await viaProvider(() => refreshLabel(label.id, { shipping: setup, email }));
}

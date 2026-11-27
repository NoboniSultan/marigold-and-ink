/**
 * Postage labels (milestone 11b, ADR 0017). After the client paid, the owner:
 * 1. fetches today's prices for the package (a rate can only be bought for a few days, so
 *    the price the client paid may be gone): the client's service comes marked, with what
 *    they paid, so a difference is seen before buying;
 * 2. buys the label from those prices, and prints its PDF (a fresh link each time);
 * 3. can void it (its postage is refunded) until the carrier scans it, then buy another.
 */
import type { LabelOption, ShippingLabel, VoidedLabel } from '@shared/types/shipping.ts';
import { ShippingProviderError, type ShippingRate } from '../../adapters/shippo.ts';
import { withTransaction } from '../../db/transaction.ts';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import * as commissionsService from '../commissions/commissions.service.js';
import * as shippingRepository from './shipping.repository.ts';
import * as labelsRepository from './shipping.labels.repository.ts';
import type { LabelRecord } from './shipping.labels.repository.ts';
import { labelOpen, offered, voidable } from './shipping.rules.ts';
import {
  assertShips,
  requireShipping,
  viaProvider,
  type CommissionLike,
  type SessionUser,
  type Setup,
} from './shipping.guards.ts';

// --- What the API returns ---

export interface LabelParts {
  label: ShippingLabel | null;
  voidedLabels: VoidedLabel[];
}

/**
 * The label in use (with its scans) and, for the admin, the voided ones. Clients see the
 * tracking, not what the postage cost or the voided labels.
 */
export async function labelParts(
  commission: CommissionLike,
  { admin }: { admin: boolean },
): Promise<LabelParts> {
  const labels = await labelsRepository.listForCommission(commission.id);
  const active = labels.find((label) => label.voidedAt === null) ?? null;
  const events = active ? await labelsRepository.listEvents(active.id) : [];
  return {
    label: active
      ? {
          carrier: active.carrier,
          serviceName: active.serviceName,
          trackingNumber: active.trackingNumber,
          trackingUrl: active.trackingUrl,
          trackingStatus: active.trackingStatus,
          trackingDetails: active.trackingDetails,
          trackingUpdatedAt: active.trackingUpdatedAt?.toISOString() ?? null,
          eta: active.eta?.toISOString() ?? null,
          createdAt: active.createdAt.toISOString(),
          events: events.map((event) => ({
            ...event,
            occurredAt: event.occurredAt?.toISOString() ?? null,
          })),
          postageCents: admin ? active.postageCents : null,
          voidable: admin && labelOpen(commission.status) && voidable(active.trackingStatus),
        }
      : null,
    voidedLabels: admin
      ? labels
          .filter((label) => label.voidedAt !== null)
          .map((label) => ({
            trackingNumber: label.trackingNumber,
            postageCents: label.postageCents,
            voidedAt: label.voidedAt!.toISOString(),
            refundStatus: label.refundStatus!,
          }))
      : [],
  };
}

// --- Checks ---

function assertLabelOpen(commission: CommissionLike) {
  if (!labelOpen(commission.status)) {
    throw new ConflictError('A label is bought after the final payment, before it ships', {
      code: 'LABEL_CLOSED',
      details: { status: commission.status },
    });
  }
}

function activeLabel(labels: LabelRecord[]): LabelRecord | null {
  return labels.find((label) => label.voidedAt === null) ?? null;
}

function assertNoLabel(labels: LabelRecord[]) {
  if (activeLabel(labels)) {
    throw new ConflictError('This commission already has a label. Void it to buy another.', {
      code: 'LABEL_EXISTS',
    });
  }
}

const staleOption = () =>
  new ConflictError('Those label prices have expired. Please get the prices again.', {
    code: 'LABEL_OPTION_STALE',
  });

// --- Prices, then buying ---

/** Today's postage for the package, cheapest first, with the client's service marked. */
export async function labelOptions(
  user: SessionUser,
  commissionId: number,
  { shipping }: { shipping?: Setup },
): Promise<LabelOption[]> {
  const setup = requireShipping(shipping);
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  assertShips(commission);
  assertLabelOpen(commission);
  assertNoLabel(await labelsRepository.listForCommission(commissionId));
  const record = await shippingRepository.findByCommission(commissionId);
  if (!record?.line1 || !record.parcel) {
    throw new ConflictError('The shipping address and package are needed for a label', {
      code: 'SHIPPING_INCOMPLETE',
      details: {
        missing: [...(record?.line1 ? [] : ['address']), ...(record?.parcel ? [] : ['package'])],
      },
    });
  }

  const quote = await viaProvider(() =>
    setup.provider.quote({
      from: setup.from,
      to: {
        name: record.name!,
        street1: record.line1!,
        street2: record.line2,
        city: record.city!,
        state: record.state!,
        zip: record.postalCode!,
      },
      parcel: record.parcel!,
    }),
  );
  const rates = offered(quote.rates);
  if (rates.length === 0) {
    throw new BusinessRuleError('No label options are available for this address and package', {
      code: 'NO_SHIPPING_OPTIONS',
    });
  }

  await withTransaction(async (tx) => {
    assertLabelOpen(await commissionsService.lockCommission(commissionId, tx));
    await shippingRepository.saveLabelQuote(commissionId, quote.shipmentId, tx);
  });
  const choice = record.choice;
  return rates.map((rate) => {
    const matchesChoice = rate.serviceToken === choice?.serviceToken;
    return {
      rateId: rate.id,
      carrier: rate.carrier,
      serviceName: rate.serviceName,
      estimatedDays: rate.estimatedDays,
      postageCents: rate.amountCents,
      paidPostageCents: matchesChoice ? choice!.postageCents : null,
      matchesChoice,
    };
  });
}

/**
 * Buys the label for one of the prices just fetched. The price is read back from the
 * shipping service by its ID and must belong to the latest prices. The commission stays
 * locked while the label is bought, so a double click can't buy two.
 */
export async function buyLabel(
  commissionId: number,
  rateId: string,
  { shipping }: { shipping?: Setup },
): Promise<void> {
  const setup = requireShipping(shipping);
  let rate: ShippingRate;
  try {
    rate = await setup.provider.getRate(rateId);
  } catch (err) {
    if (err instanceof ShippingProviderError && err.status === 404) throw staleOption();
    return viaProvider(() => Promise.reject(err));
  }
  if (offered([rate]).length === 0) {
    throw new BusinessRuleError("That shipping option isn't offered", {
      code: 'SHIPPING_OPTION_NOT_OFFERED',
    });
  }

  await withTransaction(async (tx) => {
    const commission = await commissionsService.lockCommission(commissionId, tx);
    assertShips(commission);
    assertLabelOpen(commission);
    assertNoLabel(await labelsRepository.listForCommission(commissionId, tx));
    const record = await shippingRepository.findByCommission(commissionId, tx);
    if (!record?.labelQuoteId || record.labelQuoteId !== rate.shipmentId) throw staleOption();

    let purchase;
    try {
      purchase = await setup.provider.buyLabel(rate.id, `Commission #${commissionId}`);
    } catch (err) {
      // Shippo refuses a rate that's too old to buy with a 400.
      if (err instanceof ShippingProviderError && err.status === 400) throw staleOption();
      return viaProvider(() => Promise.reject(err));
    }
    if (!purchase.ok) {
      throw new BusinessRuleError("The carrier couldn't make this label", {
        code: 'LABEL_FAILED',
        details: { messages: purchase.messages },
      });
    }
    // Logged before it's saved: if saving fails, the label was still bought and paid for,
    // and this is how to find it in the shipping service's dashboard.
    logger.info({ commissionId, transactionId: purchase.transactionId }, 'shipping label bought');
    await labelsRepository.insert(
      {
        shipmentId: record.id,
        transactionId: purchase.transactionId,
        carrier: rate.carrier,
        serviceToken: rate.serviceToken,
        serviceName: rate.serviceName,
        trackingNumber: purchase.trackingNumber,
        trackingUrl: purchase.trackingUrl,
        postageCents: rate.amountCents,
      },
      tx,
    );
    await shippingRepository.saveLabelQuote(commissionId, null, tx);
  });
}

/** A fresh link to the label in use's PDF (the shipping service's links expire). */
export async function labelFileUrl(
  commissionId: number,
  { shipping }: { shipping?: Setup },
): Promise<string> {
  const setup = requireShipping(shipping);
  const label = activeLabel(await labelsRepository.listForCommission(commissionId));
  if (!label) throw new NotFoundError('This commission has no label', { code: 'LABEL_NOT_FOUND' });
  return viaProvider(() => setup.provider.labelFileUrl(label.transactionId));
}

/**
 * Voids the label in use and asks for its postage back, while the carrier hasn't scanned
 * it. A refund can take up to two weeks to settle; the daily tracking check follows it.
 */
export async function voidLabel(
  commissionId: number,
  { shipping }: { shipping?: Setup },
): Promise<void> {
  const setup = requireShipping(shipping);
  await withTransaction(async (tx) => {
    const commission = await commissionsService.lockCommission(commissionId, tx);
    assertLabelOpen(commission);
    const label = activeLabel(await labelsRepository.listForCommission(commissionId, tx));
    if (!label)
      throw new NotFoundError('This commission has no label', { code: 'LABEL_NOT_FOUND' });
    if (!voidable(label.trackingStatus)) {
      throw new ConflictError('The carrier has already scanned this label', {
        code: 'LABEL_IN_USE',
      });
    }
    const refund = await viaProvider(() => setup.provider.requestRefund(label.transactionId));
    await labelsRepository.markVoided(label.id, refund, tx);
    logger.info(
      { commissionId, labelId: label.id, refund: refund.status },
      'shipping label voided',
    );
  });
}

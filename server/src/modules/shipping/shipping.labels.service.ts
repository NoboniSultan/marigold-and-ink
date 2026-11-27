/**
 * Postage labels (milestone 11b, ADR 0018), for a commission's shipment or, from milestone
 * 12c, a shop order's (see shipping.owners.ts). After the client paid, the owner:
 * 1. fetches today's prices for the package (a rate can only be bought for a few days, so
 *    the price the client paid may be gone): the client's service comes marked, with what
 *    they paid, so a difference is seen before buying;
 * 2. buys the label from those prices, and prints its PDF (a fresh link each time);
 * 3. can void it (its postage is refunded) until the carrier scans it, then buy another.
 */
import type { PoolClient } from 'pg';
import type { LabelOption, ShippingLabel, VoidedLabel } from '@shared/types/shipping.ts';
import {
  ShippingProviderError,
  type ShippingRate,
  type ShippingSetup,
} from '../../adapters/shippo.ts';
import { withTransaction } from '../../db/transaction.ts';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import * as shippingRepository from './shipping.repository.ts';
import type { ShipmentRecord } from './shipping.repository.ts';
import { ownerHandler, type OwnerRef, type OwnerState } from './shipping.owners.ts';
import * as labelsRepository from './shipping.labels.repository.ts';
import type { LabelRecord } from './shipping.labels.repository.ts';
import { offered, voidable } from './shipping.rules.ts';
import { requireShipping, viaProvider, type Setup } from './shipping.guards.ts';

/** The owner's shipment, or null. */
function findShipment(owner: OwnerRef, tx?: PoolClient): Promise<ShipmentRecord | null> {
  return owner.kind === 'commission'
    ? shippingRepository.findByCommission(owner.id, tx)
    : shippingRepository.findByOrder(owner.id, tx);
}

async function labelsOf(owner: OwnerRef, tx?: PoolClient): Promise<LabelRecord[]> {
  const shipment = await findShipment(owner, tx);
  return shipment ? labelsRepository.listForShipment(shipment.id, tx) : [];
}

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
  owner: OwnerRef,
  state: OwnerState,
  { admin }: { admin: boolean },
): Promise<LabelParts> {
  const labels = await labelsOf(owner);
  const ready = ownerHandler(owner.kind).stage(state) === 'ready';
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
          voidable: admin && ready && voidable(active.trackingStatus),
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

function assertShips(state: OwnerState) {
  if (!state.ships) {
    throw new ConflictError("This isn't shipped (it's delivered as files or collected)", {
      code: 'DOES_NOT_SHIP',
    });
  }
}

function assertLabelOpen(owner: OwnerRef, state: OwnerState) {
  if (ownerHandler(owner.kind).stage(state) !== 'ready') {
    throw new ConflictError('A label is bought after the payment, before it ships', {
      code: 'LABEL_CLOSED',
      details: { status: state.status },
    });
  }
}

function activeLabel(labels: LabelRecord[]): LabelRecord | null {
  return labels.find((label) => label.voidedAt === null) ?? null;
}

function assertNoLabel(labels: LabelRecord[]) {
  if (activeLabel(labels)) {
    throw new ConflictError('This already has a label. Void it to buy another.', {
      code: 'LABEL_EXISTS',
    });
  }
}

/** USPS won't make a label without the sender's email and phone (set in the server settings). */
function assertLabelSetup(setup: ShippingSetup) {
  if (!setup.from.email || !setup.from.phone) {
    throw new ServiceUnavailableError(
      'Labels need the return email and phone (SHIP_FROM_EMAIL and SHIP_FROM_PHONE) in the server settings',
      { code: 'LABEL_SETUP_INCOMPLETE' },
    );
  }
}

const staleOption = () =>
  new ConflictError('Those label prices have expired. Please get the prices again.', {
    code: 'LABEL_OPTION_STALE',
  });

// --- Prices, then buying ---

/** Today's postage for the package, cheapest first, with the client's service marked. */
export async function labelOptions(
  owner: OwnerRef,
  { shipping }: { shipping?: Setup },
): Promise<LabelOption[]> {
  const setup = requireShipping(shipping);
  assertLabelSetup(setup);
  const handler = ownerHandler(owner.kind);
  const state = await handler.load(owner.id);
  assertShips(state);
  assertLabelOpen(owner, state);
  assertNoLabel(await labelsOf(owner));
  const record = await findShipment(owner);
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
    assertLabelOpen(owner, await handler.lock(owner.id, tx));
    await shippingRepository.saveLabelQuote(record.id, quote.shipmentId, tx);
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
  owner: OwnerRef,
  rateId: string,
  { shipping }: { shipping?: Setup },
): Promise<void> {
  const setup = requireShipping(shipping);
  assertLabelSetup(setup);
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

  const handler = ownerHandler(owner.kind);
  await withTransaction(async (tx) => {
    const state = await handler.lock(owner.id, tx);
    assertShips(state);
    assertLabelOpen(owner, state);
    assertNoLabel(await labelsOf(owner, tx));
    const record = await findShipment(owner, tx);
    if (!record?.labelQuoteId || record.labelQuoteId !== rate.shipmentId) throw staleOption();

    let purchase;
    try {
      purchase = await setup.provider.buyLabel(rate.id, handler.labelNote(owner.id));
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
    logger.info({ owner, transactionId: purchase.transactionId }, 'shipping label bought');
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
    await shippingRepository.saveLabelQuote(record.id, null, tx);
  });
}

/** A fresh link to the label in use's PDF (the shipping service's links expire). */
export async function labelFileUrl(
  owner: OwnerRef,
  { shipping }: { shipping?: Setup },
): Promise<string> {
  const setup = requireShipping(shipping);
  const label = activeLabel(await labelsOf(owner));
  if (!label) throw new NotFoundError('There is no label', { code: 'LABEL_NOT_FOUND' });
  return viaProvider(() => setup.provider.labelFileUrl(label.transactionId));
}

/**
 * Voids the label in use and asks for its postage back, while the carrier hasn't scanned
 * it. A refund can take up to two weeks to settle; the daily tracking check follows it.
 */
export async function voidLabel(
  owner: OwnerRef,
  { shipping }: { shipping?: Setup },
): Promise<void> {
  const setup = requireShipping(shipping);
  await withTransaction(async (tx) => {
    assertLabelOpen(owner, await ownerHandler(owner.kind).lock(owner.id, tx));
    const label = activeLabel(await labelsOf(owner, tx));
    if (!label) throw new NotFoundError('There is no label', { code: 'LABEL_NOT_FOUND' });
    if (!voidable(label.trackingStatus)) {
      throw new ConflictError('The carrier has already scanned this label', {
        code: 'LABEL_IN_USE',
      });
    }
    const refund = await viaProvider(() => setup.provider.requestRefund(label.transactionId));
    await labelsRepository.markVoided(label.id, refund, tx);
    logger.info({ owner, labelId: label.id, refund: refund.status }, 'shipping label voided');
  });
}

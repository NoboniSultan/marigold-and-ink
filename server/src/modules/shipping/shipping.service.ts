/**
 * Shipping a physical commission (milestone 11a, ADR 0017):
 * 1. the client (or the admin) enters a US address, checked by the shipping service;
 * 2. the admin enters the package's weight and size;
 * 3. while the final payment is due, the client gets live prices and chooses an option;
 * 4. the final payment adds that option's postage plus the owner's packaging fee.
 *
 * Every price comes from the shipping service (never from a request), and a change to the
 * address or package forgets the prices quoted for the old one. Labels are in
 * shipping.labels.service.ts and tracking in shipping.tracking.service.ts (milestone 11b).
 */
import type { PoolClient } from 'pg';
import type {
  Shipment,
  ShippingAddress,
  ShippingAddressInput,
  ShippingMeta,
  ShippingOption,
  ShippingPackage,
} from '@shared/types/shipping.ts';
import {
  ShippingProviderError,
  type PostalAddress,
  type ShippingRate,
  type ShippingSetup,
} from '../../adapters/shippo.ts';
import { withTransaction } from '../../db/transaction.ts';
import { BusinessRuleError, ConflictError } from '../../errors/index.js';
import * as commissionsService from '../commissions/commissions.service.js';
import * as shippingRepository from './shipping.repository.ts';
import type { ShipmentRecord } from './shipping.repository.ts';
import {
  addressOpen,
  choosingOpen,
  labelOpen,
  offered,
  shippingCents,
  ships,
} from './shipping.rules.ts';
import {
  assertShips,
  requireShipping,
  viaProvider,
  type CommissionLike,
  type SessionUser,
  type Setup,
} from './shipping.guards.ts';
import { labelParts, type LabelParts } from './shipping.labels.service.ts';
import type { OwnerRef, OwnerState } from './shipping.owners.ts';

const commissionOwner = (commission: CommissionLike): OwnerRef => ({
  kind: 'commission',
  id: commission.id,
});
const commissionState = (commission: CommissionLike) => ({
  status: commission.status,
  ships: ships(commission.fulfillmentType),
});

function assertAddressOpen(commission: CommissionLike) {
  if (!addressOpen(commission.status)) {
    throw new ConflictError(
      'The address and package can be set from the deposit until the final payment',
      { code: 'SHIPPING_CLOSED', details: { status: commission.status } },
    );
  }
}

function assertChoosingOpen(commission: CommissionLike) {
  if (!choosingOpen(commission.status)) {
    throw new ConflictError('Shipping is chosen while the final payment is due', {
      code: 'SHIPPING_CLOSED',
      details: { status: commission.status },
    });
  }
}

// --- What the API returns ---

/** Null until it's entered, and again once removed after the client's account was deleted. */
function toAddress(record: ShipmentRecord): ShippingAddress | null {
  if (record.line1 === null) return null;
  return {
    name: record.name!,
    line1: record.line1,
    line2: record.line2,
    city: record.city!,
    state: record.state!,
    postalCode: record.postalCode!,
  };
}

/** No label yet: the address, package, and choice only change before one can be bought. */
const NO_LABEL: LabelParts = { label: null, voidedLabels: [] };

export function toShipment(record: ShipmentRecord, labels: LabelParts = NO_LABEL): Shipment {
  const choice = record.choice;
  return {
    ...labels,
    address: toAddress(record),
    addressRemovedAt: record.addressRemovedAt?.toISOString() ?? null,
    package: record.parcel,
    chosen: choice
      ? {
          carrier: choice.carrier,
          serviceName: choice.serviceName,
          estimatedDays: choice.estimatedDays,
          postageCents: choice.postageCents,
          packagingFeeCents: choice.packagingFeeCents,
          totalCents: shippingCents(choice.postageCents, choice.packagingFeeCents),
        }
      : null,
  };
}

function metaFor(
  commission: CommissionLike,
  setup: Setup,
  { admin, labels }: { admin: boolean; labels: LabelParts },
): ShippingMeta {
  const physical = ships(commission.fulfillmentType);
  return {
    shippingEnabled: Boolean(setup),
    ships: physical,
    addressOpen: physical && addressOpen(commission.status),
    choosingOpen: physical && choosingOpen(commission.status),
    labelOpen: admin && physical && labelOpen(commission.status) && labels.label === null,
  };
}

function toOption(rate: ShippingRate, packagingFeeCents: number): ShippingOption {
  return {
    rateId: rate.id,
    carrier: rate.carrier,
    serviceName: rate.serviceName,
    estimatedDays: rate.estimatedDays,
    postageCents: rate.amountCents,
    packagingFeeCents,
    totalCents: shippingCents(rate.amountCents, packagingFeeCents),
  };
}

function toPostal(record: ShipmentRecord): PostalAddress {
  return {
    name: record.name!,
    street1: record.line1!,
    street2: record.line2,
    city: record.city!,
    state: record.state!,
    zip: record.postalCode!,
  };
}

/** What a quote depends on: if this changes while prices are fetched, they don't apply. */
function quoteBasis(record: ShipmentRecord) {
  return JSON.stringify([toAddress(record), record.parcel]);
}

// --- Reading ---

/** A commission's shipment (or null) and what can be done with it now. */
export async function getShipping(
  user: SessionUser,
  commissionId: number,
  { shipping }: { shipping?: ShippingSetup | null },
): Promise<{ data: Shipment | null; meta: ShippingMeta }> {
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  const record = await shippingRepository.findByCommission(commissionId);
  const admin = user.role === 'admin';
  const labels = record
    ? await labelParts(commissionOwner(commission), commissionState(commission), { admin })
    : NO_LABEL;
  return {
    data: record ? toShipment(record, labels) : null,
    meta: metaFor(commission, shipping, { admin, labels }),
  };
}

// --- Setting the address and package ---

/**
 * The client (or the admin) sets where it goes. The shipping service checks the address
 * and returns its standard form, which is what's stored; prices quoted for an earlier
 * address are forgotten.
 */
export async function setAddress(
  user: SessionUser,
  commissionId: number,
  input: ShippingAddressInput,
  { shipping }: { shipping?: ShippingSetup | null },
): Promise<Shipment> {
  const setup = requireShipping(shipping);
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  assertShips(commission);
  assertAddressOpen(commission);

  const check = await viaProvider(() =>
    setup.provider.checkAddress({
      name: input.name,
      street1: input.line1,
      street2: input.line2 ?? null,
      city: input.city,
      state: input.state,
      zip: input.postalCode,
    }),
  );
  if (!check.valid) {
    throw new BusinessRuleError(
      "That address couldn't be confirmed as deliverable. Please check it and try again.",
      { code: 'ADDRESS_NOT_DELIVERABLE', details: { messages: check.messages } },
    );
  }

  return withTransaction(async (tx) => {
    const locked = await commissionsService.lockCommission(commissionId, tx);
    assertAddressOpen(locked); // it may have moved on while the address was checked
    const record = await shippingRepository.saveAddress(
      commissionId,
      {
        name: check.address.name,
        line1: check.address.street1,
        line2: check.address.street2,
        city: check.address.city,
        state: check.address.state,
        postalCode: check.address.zip,
      },
      tx,
    );
    return toShipment(record);
  });
}

/** The admin sets the package's weight and size; prices quoted for the old one are forgotten. */
export async function setPackage(
  commissionId: number,
  parcel: ShippingPackage,
  { shipping }: { shipping?: ShippingSetup | null },
): Promise<Shipment> {
  requireShipping(shipping);
  return withTransaction(async (tx) => {
    const commission = await commissionsService.lockCommission(commissionId, tx);
    assertShips(commission);
    assertAddressOpen(commission);
    return toShipment(await shippingRepository.savePackage(commissionId, parcel, tx));
  });
}

// --- Prices and the client's choice ---

/** Live prices for the address and package, cheapest first, with the packaging fee added. */
export async function quoteOptions(
  user: SessionUser,
  commissionId: number,
  { shipping }: { shipping?: ShippingSetup | null },
): Promise<ShippingOption[]> {
  const setup = requireShipping(shipping);
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  assertShips(commission);
  assertChoosingOpen(commission);
  const record = await shippingRepository.findByCommission(commissionId);
  const missing = [...(record?.line1 ? [] : ['address']), ...(record?.parcel ? [] : ['package'])];
  if (!record || missing.length > 0) {
    throw new ConflictError(
      missing.includes('package')
        ? "Shipping prices will be ready once the package details are in. We'll add them soon."
        : 'Enter the shipping address first',
      { code: 'SHIPPING_INCOMPLETE', details: { missing } },
    );
  }

  const quote = await viaProvider(() =>
    setup.provider.quote({ from: setup.from, to: toPostal(record), parcel: record.parcel! }),
  );
  const rates = offered(quote.rates);
  if (rates.length === 0) {
    throw new BusinessRuleError(
      'No shipping options are available for this address and package. Please contact us.',
      { code: 'NO_SHIPPING_OPTIONS' },
    );
  }

  await withTransaction(async (tx) => {
    const locked = await commissionsService.lockCommission(commissionId, tx);
    assertChoosingOpen(locked);
    const current = await shippingRepository.findByCommission(commissionId, tx);
    if (!current || quoteBasis(current) !== quoteBasis(record)) {
      throw new ConflictError('The address or package changed. Please get the prices again.', {
        code: 'SHIPPING_CHANGED',
      });
    }
    await shippingRepository.saveQuote(commissionId, quote.shipmentId, tx);
  });
  return rates.map((rate) => toOption(rate, setup.packagingFeeCents));
}

/**
 * The client (or the admin) chooses one of the quoted options. The price is read back from
 * the shipping service by the option's ID, and must belong to the latest quote.
 */
export async function chooseOption(
  user: SessionUser,
  commissionId: number,
  rateId: string,
  { shipping }: { shipping?: ShippingSetup | null },
): Promise<Shipment> {
  const setup = requireShipping(shipping);
  const commission = await commissionsService.getCommissionForUser(commissionId, user);
  assertShips(commission);
  assertChoosingOpen(commission);
  const stale = () =>
    new ConflictError('That shipping option has expired. Please get the prices again.', {
      code: 'SHIPPING_OPTION_STALE',
    });

  let rate: ShippingRate;
  try {
    rate = await setup.provider.getRate(rateId);
  } catch (err) {
    // An ID the shipping service doesn't know is a stale or made-up choice, not an outage.
    if (err instanceof ShippingProviderError && err.status === 404) throw stale();
    return viaProvider(() => Promise.reject(err));
  }
  if (offered([rate]).length === 0) {
    throw new BusinessRuleError("That shipping option isn't offered", {
      code: 'SHIPPING_OPTION_NOT_OFFERED',
    });
  }

  return withTransaction(async (tx) => {
    const locked = await commissionsService.lockCommission(commissionId, tx);
    assertChoosingOpen(locked);
    const record = await shippingRepository.findByCommission(commissionId, tx);
    if (!record?.providerShipmentId || record.providerShipmentId !== rate.shipmentId) {
      throw stale();
    }
    const saved = await shippingRepository.saveChoice(
      commissionId,
      {
        rateId: rate.id,
        carrier: rate.carrier,
        serviceToken: rate.serviceToken,
        serviceName: rate.serviceName,
        estimatedDays: rate.estimatedDays,
        postageCents: rate.amountCents,
        packagingFeeCents: setup.packagingFeeCents,
      },
      tx,
    );
    return toShipment(saved);
  });
}

// --- The final payment ---

/**
 * What the final payment adds for shipping, inside the payment's transaction (the
 * commission is already locked). Digital and mixed-media work adds nothing. For physical
 * work an option must be chosen, and its price is checked again with the shipping service
 * so a client never pays an outdated amount.
 */
export async function chargeForFinalPayment(
  commission: CommissionLike,
  { shipping, client }: { shipping?: ShippingSetup | null; client: PoolClient },
): Promise<{ shippingCents: number; label: string } | null> {
  if (!ships(commission.fulfillmentType)) return null;
  const setup = requireShipping(shipping);
  const record = await shippingRepository.findByCommission(commission.id, client);
  const choice = record?.choice;
  if (!choice) {
    throw new ConflictError('Choose a shipping option before paying the balance', {
      code: 'SHIPPING_NOT_CHOSEN',
    });
  }
  const changed = () =>
    new ConflictError('The shipping price has changed. Please choose shipping again.', {
      code: 'SHIPPING_PRICE_CHANGED',
    });
  let current: ShippingRate;
  try {
    current = await setup.provider.getRate(choice.rateId);
  } catch (err) {
    if (err instanceof ShippingProviderError && err.status === 404) throw changed();
    return viaProvider(() => Promise.reject(err));
  }
  if (current.amountCents !== choice.postageCents) throw changed();
  return {
    shippingCents: shippingCents(choice.postageCents, choice.packagingFeeCents),
    label: `Shipping & packaging (${choice.carrier} ${choice.serviceName})`,
  };
}

// --- Account deletion and export ---

/** Removes the name and street from a deleted client's shipments (keeps city, state, ZIP). */
export function removeAddressesForDeletedClient(
  clientId: number,
  { client }: { client: PoolClient },
) {
  return shippingRepository.removeStreetForClient(clientId, client);
}

/** The commission's shipment (as the client sees it) for their data download, or null. */
export async function shipmentForExport(commission: CommissionLike): Promise<Shipment | null> {
  const record = await shippingRepository.findByCommission(commission.id);
  return record
    ? toShipment(
        record,
        await labelParts(commissionOwner(commission), commissionState(commission), {
          admin: false,
        }),
      )
    : null;
}

// --- Shop orders (milestone 12c, ADR 0021) ---

export interface ParcelQuote {
  /** The address as the carrier standardized it. */
  address: ShippingAddress;
  /** The shipping service's quote the rates belong to. */
  providerShipmentId: string;
  /** Offered services, cheapest first. */
  rates: ShippingRate[];
  packagingFeeCents: number;
}

/**
 * Checks an address and prices a package to it (for a cart). Answers 422
 * ADDRESS_NOT_DELIVERABLE with the carrier's reasons, or NO_SHIPPING_OPTIONS.
 */
export async function quoteParcel(
  to: ShippingAddressInput,
  parcel: ShippingPackage,
  { shipping }: { shipping?: ShippingSetup | null },
): Promise<ParcelQuote> {
  const setup = requireShipping(shipping);
  const check = await viaProvider(() =>
    setup.provider.checkAddress({
      name: to.name,
      street1: to.line1,
      street2: to.line2 ?? null,
      city: to.city,
      state: to.state,
      zip: to.postalCode,
    }),
  );
  if (!check.valid) {
    throw new BusinessRuleError(
      "That address couldn't be confirmed as deliverable. Please check it and try again.",
      { code: 'ADDRESS_NOT_DELIVERABLE', details: { messages: check.messages } },
    );
  }
  const quote = await viaProvider(() =>
    setup.provider.quote({ from: setup.from, to: check.address, parcel }),
  );
  const rates = offered(quote.rates);
  if (rates.length === 0) {
    throw new BusinessRuleError(
      'No shipping options are available for this address and package. Please contact us.',
      { code: 'NO_SHIPPING_OPTIONS' },
    );
  }
  return {
    address: {
      name: check.address.name,
      line1: check.address.street1,
      line2: check.address.street2,
      city: check.address.city,
      state: check.address.state,
      postalCode: check.address.zip,
    },
    providerShipmentId: quote.shipmentId,
    rates,
    packagingFeeCents: setup.packagingFeeCents,
  };
}

/** Records a shop order's shipment at checkout, in the checkout's transaction. */
export async function recordOrderShipment(
  orderId: number,
  { quote, rate, parcel }: { quote: ParcelQuote; rate: ShippingRate; parcel: ShippingPackage },
  { client }: { client: PoolClient },
): Promise<void> {
  await shippingRepository.insertOrderShipment(
    orderId,
    {
      address: quote.address,
      parcel,
      providerShipmentId: quote.providerShipmentId,
      choice: {
        rateId: rate.id,
        carrier: rate.carrier,
        serviceToken: rate.serviceToken,
        serviceName: rate.serviceName,
        estimatedDays: rate.estimatedDays,
        postageCents: rate.amountCents,
        packagingFeeCents: quote.packagingFeeCents,
      },
    },
    client,
  );
}

/**
 * A shop order's shipment (with its label and tracking), or null for a pickup. `state` is
 * the order's, for whether its label may be voided; clients don't see costs or voided labels.
 */
export async function orderShipment(
  orderId: number,
  state: OwnerState,
  { admin }: { admin: boolean },
): Promise<Shipment | null> {
  const record = await shippingRepository.findByOrder(orderId);
  if (!record) return null;
  return toShipment(record, await labelParts({ kind: 'order', id: orderId }, state, { admin }));
}

/** The ID of an order's shipment, or null (for its emails' tracking). */
export async function orderShipmentId(orderId: number): Promise<number | null> {
  return (await shippingRepository.findByOrder(orderId))?.id ?? null;
}

/** The address of a client's latest shipped order, to fill in the next one; or null. */
export async function lastOrderAddress(clientId: number): Promise<ShippingAddress | null> {
  const record = await shippingRepository.lastOrderAddress(clientId);
  return record ? toAddress(record) : null;
}

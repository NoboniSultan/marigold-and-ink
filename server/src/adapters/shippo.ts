/**
 * Shippo's shipping API: the only code that calls it (milestone 11, ADR 0017).
 * https://docs.goshippo.com/
 *
 * - POST /addresses with validate=true checks a US address and returns it standardized.
 * - POST /shipments prices a package from one address to another: the answer holds one
 *   rate per carrier service. Rates belong to that shipment and are bought later by ID.
 * - GET /rates/:id reads one rate back, so a price is always taken from Shippo, never from
 *   what a browser sends.
 * - POST /transactions buys a rate's label (milestone 11b); GET /transactions/:id gives a
 *   fresh link to its PDF each time (links expire). POST /refunds voids an unused label.
 * - GET /tracks/:carrier/:number says where a package is. Webhooks only say "something
 *   changed"; the answer is always read from here, with the app's own token.
 *
 * Amounts arrive as decimal text ("7.58") and are turned into integer cents exactly.
 */
import { z } from 'zod';
import type { TrackingStatus } from '@shared/types/shipping.ts';
import { centsFromDecimal } from '../lib/money.js';

const BASE_URL = 'https://api.goshippo.com';
const REQUEST_TIMEOUT_MS = 15_000;

export interface PostalAddress {
  name: string;
  street1: string;
  street2: string | null;
  city: string;
  /** Two-letter state code. */
  state: string;
  zip: string;
}

export interface AddressCheck {
  valid: boolean;
  /** As standardized by the carrier when valid; otherwise as sent. */
  address: PostalAddress;
  /** Why it isn't valid (or notes about corrections), safe to show. */
  messages: string[];
}

/** Ounces and inches. */
export interface Parcel {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export interface ShippingRate {
  id: string;
  /** The Shippo shipment this rate was quoted for. */
  shipmentId: string;
  carrier: string;
  serviceToken: string;
  serviceName: string;
  estimatedDays: number | null;
  amountCents: number;
}

/** A bought label, or the carrier's reasons it couldn't be made (safe to show). */
export type LabelPurchase =
  | { ok: true; transactionId: string; trackingNumber: string; trackingUrl: string | null }
  | { ok: false; messages: string[] };

export type RefundStatus = 'queued' | 'pending' | 'success' | 'error';

export interface Refund {
  id: string;
  status: RefundStatus;
}

export interface TrackingScan {
  /** The shipping service's own ID for the scan. */
  id: string;
  status: TrackingStatus;
  details: string | null;
  occurredAt: Date | null;
  city: string | null;
  state: string | null;
}

export interface TrackingInfo {
  status: TrackingStatus;
  details: string | null;
  updatedAt: Date | null;
  eta: Date | null;
  scans: TrackingScan[];
}

export interface ShippingProvider {
  checkAddress(address: PostalAddress): Promise<AddressCheck>;
  quote(input: {
    from: PostalAddress;
    to: PostalAddress;
    parcel: Parcel;
  }): Promise<{ shipmentId: string; rates: ShippingRate[] }>;
  getRate(rateId: string): Promise<ShippingRate>;
  /** Buys postage for a rate. `note` is shown with the label in the shipping service's dashboard. */
  buyLabel(rateId: string, note: string): Promise<LabelPurchase>;
  /** A fresh link to the label PDF; it expires, so it's fetched each time it's needed. */
  labelFileUrl(transactionId: string): Promise<string>;
  /** Asks for an unused label's postage back. */
  requestRefund(transactionId: string): Promise<Refund>;
  getRefund(refundId: string): Promise<Refund>;
  /** Where a package is now, with every scan so far. */
  track(carrier: string, trackingNumber: string): Promise<TrackingInfo>;
}

/**
 * Letter-size PDF (8.5 x 11 in), for a regular printer (owner decision, 2026-11-26).
 * 'PDF_4x6' would suit a label printer.
 */
export const LABEL_FILE_TYPE = 'PDF';

export class ShippingProviderError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ShippingProviderError';
    this.status = status;
  }
}

const addressSchema = z.object({
  object_id: z.string().optional(),
  name: z.string().nullish(),
  street1: z.string().nullish(),
  street2: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  zip: z.string().nullish(),
  validation_results: z
    .object({
      is_valid: z.boolean().nullish(),
      messages: z.array(z.object({ text: z.string().nullish() })).nullish(),
    })
    .nullish(),
});

const rateSchema = z.object({
  object_id: z.string().min(1),
  shipment: z.string().min(1),
  amount: z.string(),
  currency: z.string(),
  provider: z.string().min(1),
  servicelevel: z.object({ name: z.string().nullish(), token: z.string().min(1) }),
  estimated_days: z.number().int().nonnegative().nullish(),
});

const shipmentSchema = z.object({
  object_id: z.string().min(1),
  rates: z.array(z.unknown()),
});

function toRate(raw: unknown): ShippingRate | null {
  const parsed = rateSchema.safeParse(raw);
  if (!parsed.success || parsed.data.currency.toUpperCase() !== 'USD') return null;
  const rate = parsed.data;
  let amountCents: number;
  try {
    amountCents = centsFromDecimal(rate.amount);
  } catch {
    return null;
  }
  return {
    id: rate.object_id,
    shipmentId: rate.shipment,
    carrier: rate.provider,
    serviceToken: rate.servicelevel.token,
    serviceName: rate.servicelevel.name || rate.servicelevel.token,
    estimatedDays: rate.estimated_days ?? null,
    amountCents,
  };
}

const transactionSchema = z.object({
  object_id: z.string().min(1),
  status: z.string(),
  tracking_number: z.string().nullish(),
  tracking_url_provider: z.string().nullish(),
  label_url: z.string().nullish(),
  messages: z.array(z.object({ text: z.string().nullish() }).passthrough()).nullish(),
});

const refundSchema = z.object({
  object_id: z.string().min(1),
  status: z
    .string()
    .transform((s) => s.toLowerCase())
    .pipe(z.enum(['queued', 'pending', 'success', 'error'])),
});

const TRACKING_STATUSES = [
  'unknown',
  'pre_transit',
  'transit',
  'delivered',
  'returned',
  'failure',
] as const satisfies readonly TrackingStatus[];

/** Shippo's upper-case status, or 'unknown' for anything missing or new. */
function toTrackingStatus(raw: unknown): TrackingStatus {
  const value = typeof raw === 'string' ? raw.toLowerCase() : '';
  return (TRACKING_STATUSES as readonly string[]).includes(value)
    ? (value as TrackingStatus)
    : 'unknown';
}

/** A date Shippo sent, or null if it's missing or not a date. */
function toDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Text Shippo sent, trimmed and cut to `max`, or null. */
function toText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  return text ? text.slice(0, max) : null;
}

// Optional, because Zod 4 requires an object key even when its value may be anything.
const scanSchema = z.object({
  object_id: z.string().min(1).max(100),
  status: z.unknown().optional(),
  status_details: z.unknown().optional(),
  status_date: z.unknown().optional(),
  location: z.object({ city: z.unknown().optional(), state: z.unknown().optional() }).nullish(),
});

const trackSchema = z.object({
  eta: z.unknown().optional(),
  tracking_status: scanSchema.partial().nullish(),
  tracking_history: z.array(z.unknown()).nullish(),
});

function toScan(raw: unknown): TrackingScan | null {
  const parsed = scanSchema.safeParse(raw);
  if (!parsed.success) return null;
  const scan = parsed.data;
  return {
    id: scan.object_id,
    status: toTrackingStatus(scan.status),
    details: toText(scan.status_details, 500),
    occurredAt: toDate(scan.status_date),
    city: toText(scan.location?.city, 100),
    state: toText(scan.location?.state, 50),
  };
}

function toShippo(address: PostalAddress) {
  return {
    name: address.name,
    street1: address.street1,
    ...(address.street2 ? { street2: address.street2 } : {}),
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: 'US',
  };
}

export function createShippo({
  apiKey,
  fetchImpl = fetch,
}: {
  apiKey: string;
  fetchImpl?: typeof fetch;
}): ShippingProvider {
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `ShippoToken ${apiKey}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ShippingProviderError('Shippo could not be reached', null, { cause: err });
    }
    if (!response.ok) {
      throw new ShippingProviderError(`Shippo answered ${response.status}`, response.status);
    }
    return response.json();
  }

  const unexpected = () => new ShippingProviderError('Unexpected answer from Shippo', 200);

  return {
    async checkAddress(address) {
      const body = await call('/addresses/', {
        method: 'POST',
        body: JSON.stringify({ ...toShippo(address), validate: true }),
      });
      const parsed = addressSchema.safeParse(body);
      if (!parsed.success) throw unexpected();
      const answer = parsed.data;
      const valid = answer.validation_results?.is_valid === true;
      const messages = (answer.validation_results?.messages ?? [])
        .map((m) => m.text?.trim())
        .filter((text): text is string => Boolean(text));
      return {
        valid,
        messages,
        address: valid
          ? {
              // The name is the client's own; the rest is the carrier's standard form.
              name: address.name,
              street1: answer.street1 || address.street1,
              street2: answer.street2 || null,
              city: answer.city || address.city,
              state: (answer.state || address.state).toUpperCase(),
              zip: answer.zip || address.zip,
            }
          : address,
      };
    },

    async quote({ from, to, parcel }) {
      const body = await call('/shipments/', {
        method: 'POST',
        body: JSON.stringify({
          address_from: toShippo(from),
          address_to: toShippo(to),
          parcels: [
            {
              length: String(parcel.lengthIn),
              width: String(parcel.widthIn),
              height: String(parcel.heightIn),
              distance_unit: 'in',
              weight: String(parcel.weightOz),
              mass_unit: 'oz',
            },
          ],
          async: false,
        }),
      });
      const parsed = shipmentSchema.safeParse(body);
      if (!parsed.success) throw unexpected();
      const rates = parsed.data.rates
        .map(toRate)
        .filter((rate): rate is ShippingRate => rate !== null);
      return { shipmentId: parsed.data.object_id, rates };
    },

    async getRate(rateId) {
      const body = await call(`/rates/${encodeURIComponent(rateId)}`);
      const rate = toRate(body);
      if (!rate) throw unexpected();
      return rate;
    },

    async buyLabel(rateId, note) {
      const body = await call('/transactions/', {
        method: 'POST',
        body: JSON.stringify({
          rate: rateId,
          label_file_type: LABEL_FILE_TYPE,
          metadata: note.slice(0, 100),
          async: false,
        }),
      });
      const parsed = transactionSchema.safeParse(body);
      if (!parsed.success) throw unexpected();
      const answer = parsed.data;
      if (answer.status !== 'SUCCESS') {
        const messages = (answer.messages ?? [])
          .map((m) => m.text?.trim())
          .filter((text): text is string => Boolean(text));
        return { ok: false, messages };
      }
      const trackingNumber = toText(answer.tracking_number, 100);
      if (!trackingNumber) throw unexpected();
      const url = toText(answer.tracking_url_provider, 2000);
      return {
        ok: true,
        transactionId: answer.object_id,
        trackingNumber,
        trackingUrl: url?.startsWith('https://') ? url : null,
      };
    },

    async labelFileUrl(transactionId) {
      const body = await call(`/transactions/${encodeURIComponent(transactionId)}`);
      const parsed = transactionSchema.safeParse(body);
      const url = parsed.success ? parsed.data.label_url : null;
      if (!url?.startsWith('https://')) throw unexpected();
      return url;
    },

    async requestRefund(transactionId) {
      const body = await call('/refunds/', {
        method: 'POST',
        body: JSON.stringify({ transaction: transactionId, async: false }),
      });
      const parsed = refundSchema.safeParse(body);
      if (!parsed.success) throw unexpected();
      return { id: parsed.data.object_id, status: parsed.data.status };
    },

    async getRefund(refundId) {
      const body = await call(`/refunds/${encodeURIComponent(refundId)}`);
      const parsed = refundSchema.safeParse(body);
      if (!parsed.success) throw unexpected();
      return { id: parsed.data.object_id, status: parsed.data.status };
    },

    async track(carrier, trackingNumber) {
      const body = await call(
        `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(trackingNumber)}`,
      );
      const parsed = trackSchema.safeParse(body);
      if (!parsed.success) throw unexpected();
      const current = parsed.data.tracking_status;
      const scans = (parsed.data.tracking_history ?? [])
        .map(toScan)
        .filter((scan): scan is TrackingScan => scan !== null);
      return {
        status: toTrackingStatus(current?.status),
        details: toText(current?.status_details, 500),
        updatedAt: toDate(current?.status_date),
        eta: toDate(parsed.data.eta),
        scans,
      };
    },
  };
}

/** Shipping as the app uses it: the provider plus the owner's settings (from config). */
export interface ShippingSetup {
  provider: ShippingProvider;
  /** Added to every shipment's postage. An owner-set business value. */
  packagingFeeCents: number;
  /** The return address printed on labels. */
  from: PostalAddress;
  /** The secret in the tracking webhook's link; null = the webhook is off. */
  webhookToken: string | null;
}

/**
 * Shippo's shipping API: the only code that calls it (milestone 11, ADR 0017).
 * https://docs.goshippo.com/
 *
 * - POST /addresses with validate=true checks a US address and returns it standardized.
 * - POST /shipments prices a package from one address to another: the answer holds one
 *   rate per carrier service. Rates belong to that shipment and are bought later by ID.
 * - GET /rates/:id reads one rate back, so a price is always taken from Shippo, never from
 *   what a browser sends.
 *
 * Amounts arrive as decimal text ("7.58") and are turned into integer cents exactly.
 */
import { z } from 'zod';
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

export interface ShippingProvider {
  checkAddress(address: PostalAddress): Promise<AddressCheck>;
  quote(input: {
    from: PostalAddress;
    to: PostalAddress;
    parcel: Parcel;
  }): Promise<{ shipmentId: string; rates: ShippingRate[] }>;
  getRate(rateId: string): Promise<ShippingRate>;
}

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
  };
}

/** Shipping as the app uses it: the provider plus the owner's settings (from config). */
export interface ShippingSetup {
  provider: ShippingProvider;
  /** Added to every shipment's postage. An owner-set business value. */
  packagingFeeCents: number;
  /** The return address printed on labels. */
  from: PostalAddress;
}

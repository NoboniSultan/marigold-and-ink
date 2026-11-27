/**
 * A fake shipping service (the Shippo adapter's interface) for tests: answers from
 * in-memory settings, records what it was asked, and can be told to fail.
 */
import type {
  PostalAddress,
  RefundStatus,
  ShippingProvider,
  ShippingRate,
  ShippingSetup,
  TrackingInfo,
} from '../../src/adapters/shippo.ts';
import { ShippingProviderError } from '../../src/adapters/shippo.ts';

/** A test packaging fee (deliberately unlike any real one). */
export const TEST_PACKAGING_FEE_CENTS = 333;

/** A test webhook secret (32+ characters, like the real setting requires). */
export const TEST_WEBHOOK_TOKEN = 'test-webhook-token-0123456789abcdef';

export const TEST_FROM: PostalAddress = {
  name: 'Test Studio',
  street1: '1 Test St',
  street2: null,
  city: 'Testville',
  state: 'NY',
  zip: '10001',
  email: 'studio@example.com',
  phone: '212-555-0100',
};

/** The services a quote answers with, by token: [name, cents, days]. */
const DEFAULT_SERVICES: [string, string, number, number | null][] = [
  ['usps_priority', 'Priority Mail', 1210, 2],
  ['usps_ground_advantage', 'Ground Advantage', 758, 4],
  ['usps_media_mail', 'Media Mail', 400, 8],
  ['ups_ground', 'UPS Ground', 900, null],
];

export function fakeShipping() {
  const calls = {
    checkAddress: [] as PostalAddress[],
    quote: [] as Parameters<ShippingProvider['quote']>[0][],
    getRate: [] as string[],
    buyLabel: [] as { rateId: string; note: string }[],
    labelFileUrl: [] as string[],
    requestRefund: [] as string[],
    getRefund: [] as string[],
    track: [] as { carrier: string; trackingNumber: string }[],
  };
  const settings = {
    /** null = valid; otherwise the reasons it isn't. */
    invalidAddress: null as string[] | null,
    services: DEFAULT_SERVICES,
    /** Changes the price getRate reports, as if postage changed since the quote. */
    priceChange: 0,
    /** Runs while a quote is being made, e.g. to change the address meanwhile. */
    duringQuote: null as null | (() => Promise<void>),
    /** Throws once from the next call of this method. */
    failNext: null as null | { method: keyof typeof calls; status: number | null },
    /** null = labels are made; otherwise the carrier's reasons it couldn't make one. */
    labelFails: null as string[] | null,
    /** What a refund request answers (and getRefund, once changed). */
    refundStatus: 'queued' as RefundStatus,
    /** What tracking answers, by tracking number (unknown numbers: no news yet). */
    tracking: new Map<string, TrackingInfo>(),
  };
  const rates = new Map<string, ShippingRate>();
  let shipments = 0;
  let labels = 0;

  function maybeFail(method: keyof typeof calls) {
    if (settings.failNext?.method !== method) return;
    const { status } = settings.failNext;
    settings.failNext = null;
    throw new ShippingProviderError(`Shippo answered ${status}`, status);
  }

  const provider: ShippingProvider = {
    async checkAddress(address) {
      calls.checkAddress.push(address);
      maybeFail('checkAddress');
      if (settings.invalidAddress) {
        return { valid: false, messages: settings.invalidAddress, address };
      }
      // Standardized like USPS does: capital letters, ZIP+4.
      return {
        valid: true,
        messages: [],
        address: {
          ...address,
          street1: address.street1.toUpperCase(),
          city: address.city.toUpperCase(),
          state: address.state.toUpperCase(),
          zip: address.zip.length === 5 ? `${address.zip}-0001` : address.zip,
        },
      };
    },
    async quote(input) {
      calls.quote.push(input);
      maybeFail('quote');
      await settings.duringQuote?.();
      shipments += 1;
      const shipmentId = `shp_${shipments}`;
      const list = settings.services.map(([token, name, cents, days]) => {
        const rate: ShippingRate = {
          id: `rate_${shipments}_${token}`,
          shipmentId,
          carrier: token.startsWith('ups') ? 'UPS' : 'USPS',
          serviceToken: token,
          serviceName: name,
          estimatedDays: days,
          amountCents: cents,
        };
        rates.set(rate.id, rate);
        return rate;
      });
      return { shipmentId, rates: list };
    },
    async getRate(rateId) {
      calls.getRate.push(rateId);
      maybeFail('getRate');
      const rate = rates.get(rateId);
      if (!rate) throw new ShippingProviderError('Shippo answered 404', 404);
      return { ...rate, amountCents: rate.amountCents + settings.priceChange };
    },
    async buyLabel(rateId, note) {
      calls.buyLabel.push({ rateId, note });
      maybeFail('buyLabel');
      if (settings.labelFails) return { ok: false, messages: settings.labelFails };
      labels += 1;
      return {
        ok: true,
        transactionId: `txn_${labels}`,
        trackingNumber: `9400TEST${labels}`,
        trackingUrl: `https://tools.usps.com/go/TrackConfirmAction?tLabels=9400TEST${labels}`,
      };
    },
    async labelFileUrl(transactionId) {
      calls.labelFileUrl.push(transactionId);
      maybeFail('labelFileUrl');
      return `https://labels.example/${transactionId}.pdf?Expires=1`;
    },
    async requestRefund(transactionId) {
      calls.requestRefund.push(transactionId);
      maybeFail('requestRefund');
      return { id: `ref_${transactionId}`, status: settings.refundStatus };
    },
    async getRefund(refundId) {
      calls.getRefund.push(refundId);
      maybeFail('getRefund');
      return { id: refundId, status: settings.refundStatus };
    },
    async track(carrier, trackingNumber) {
      calls.track.push({ carrier, trackingNumber });
      maybeFail('track');
      return (
        settings.tracking.get(trackingNumber) ?? {
          status: 'unknown',
          details: null,
          updatedAt: null,
          eta: null,
          scans: [],
        }
      );
    },
  };

  const setup: ShippingSetup = {
    provider,
    packagingFeeCents: TEST_PACKAGING_FEE_CENTS,
    from: TEST_FROM,
    webhookToken: TEST_WEBHOOK_TOKEN,
  };
  return { setup, calls, settings };
}

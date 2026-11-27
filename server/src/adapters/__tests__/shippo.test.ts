/** The real Shippo adapter, with a fake fetch: no request ever leaves the machine. */
import { describe, it, expect, vi } from 'vitest';
import { ShippingProviderError, createShippo, type PostalAddress } from '../shippo.ts';

function shippoWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) =>
    respond(String(url), init),
  );
  const shippo = createShippo({
    apiKey: 'shippo_test_key',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { shippo, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TO: PostalAddress = {
  name: 'Ana Client',
  street1: '215 Clayton St',
  street2: null,
  city: 'San Francisco',
  state: 'ca',
  zip: '94117',
};
const FROM: PostalAddress = { ...TO, name: 'Studio', street2: 'Unit 2' };

const rate = (overrides: Record<string, unknown> = {}) => ({
  object_id: 'rate_1',
  shipment: 'shp_1',
  amount: '7.58',
  currency: 'USD',
  provider: 'USPS',
  servicelevel: { name: 'Ground Advantage', token: 'usps_ground_advantage' },
  estimated_days: 3,
  ...overrides,
});

describe('createShippo: checkAddress', () => {
  it('asks Shippo to validate a US address and returns its standard form', async () => {
    const { shippo, fetchImpl } = shippoWith(() =>
      json({
        object_id: 'adr_1',
        name: 'ANA CLIENT',
        street1: '215 CLAYTON ST',
        city: 'SAN FRANCISCO',
        state: 'CA',
        zip: '94117-1913',
        validation_results: { is_valid: true, messages: [] },
      }),
    );

    await expect(shippo.checkAddress(TO)).resolves.toEqual({
      valid: true,
      messages: [],
      address: {
        name: 'Ana Client',
        street1: '215 CLAYTON ST',
        street2: null,
        city: 'SAN FRANCISCO',
        state: 'CA',
        zip: '94117-1913',
      },
    });
    const [url, init = {}] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.goshippo.com/addresses/');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'ShippoToken shippo_test_key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Ana Client',
      street1: '215 Clayton St',
      city: 'San Francisco',
      state: 'ca',
      zip: '94117',
      country: 'US',
      validate: true,
    });
  });

  it('keeps what was sent where the answer leaves fields out', async () => {
    const { shippo } = shippoWith(() => json({ validation_results: { is_valid: true } }));

    expect((await shippo.checkAddress(TO)).address).toEqual({ ...TO, state: 'CA' });
  });

  it("reports an invalid address with the carrier's reasons", async () => {
    const { shippo } = shippoWith(() =>
      json({
        street1: '1 Nowhere',
        validation_results: {
          is_valid: false,
          messages: [{ text: 'Address not found' }, { text: ' ' }, {}],
        },
      }),
    );

    await expect(shippo.checkAddress(TO)).resolves.toEqual({
      valid: false,
      messages: ['Address not found'],
      address: TO,
    });
  });

  it('treats a missing verdict as not valid', async () => {
    const { shippo } = shippoWith(() => json({}));
    expect((await shippo.checkAddress(TO)).valid).toBe(false);
  });

  it('sends the second street line when there is one', async () => {
    const { shippo, fetchImpl } = shippoWith(() => json({}));
    await shippo.checkAddress(FROM);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body)).street2).toBe('Unit 2');
  });

  it('refuses an answer it cannot read', async () => {
    const { shippo } = shippoWith(() => json({ name: 42 }));
    await expect(shippo.checkAddress(TO)).rejects.toThrow('Unexpected answer from Shippo');
  });
});

describe('createShippo: quote', () => {
  const parcel = { weightOz: 12, lengthIn: 18, widthIn: 14, heightIn: 0.5 };

  it('prices a package in ounces and inches and returns the readable USD rates', async () => {
    const { shippo, fetchImpl } = shippoWith(() =>
      json({
        object_id: 'shp_1',
        rates: [
          rate(),
          rate({ object_id: 'rate_2', amount: '10', servicelevel: { token: 'usps_priority' } }),
          rate({ object_id: 'rate_3', currency: 'CAD' }),
          rate({ object_id: 'rate_4', amount: 'free' }),
          { object_id: 'broken' },
        ],
      }),
    );

    await expect(shippo.quote({ from: FROM, to: TO, parcel })).resolves.toEqual({
      shipmentId: 'shp_1',
      rates: [
        {
          id: 'rate_1',
          shipmentId: 'shp_1',
          carrier: 'USPS',
          serviceToken: 'usps_ground_advantage',
          serviceName: 'Ground Advantage',
          estimatedDays: 3,
          amountCents: 758,
        },
        {
          id: 'rate_2',
          shipmentId: 'shp_1',
          carrier: 'USPS',
          serviceToken: 'usps_priority',
          serviceName: 'usps_priority',
          estimatedDays: 3,
          amountCents: 1000,
        },
      ],
    });
    const [url, init = {}] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.goshippo.com/shipments/');
    const body = JSON.parse(String(init.body));
    expect(body.parcels).toEqual([
      {
        length: '18',
        width: '14',
        height: '0.5',
        distance_unit: 'in',
        weight: '12',
        mass_unit: 'oz',
      },
    ]);
    expect(body.address_from.street2).toBe('Unit 2');
    expect(body.address_to.country).toBe('US');
    expect(body.async).toBe(false);
  });

  it('refuses an answer without a shipment', async () => {
    const { shippo } = shippoWith(() => json({ rates: [] }));
    await expect(shippo.quote({ from: FROM, to: TO, parcel })).rejects.toThrow(
      ShippingProviderError,
    );
  });
});

describe('createShippo: getRate', () => {
  it('reads one rate back by ID', async () => {
    const { shippo, fetchImpl } = shippoWith(() => json(rate({ estimated_days: null })));

    await expect(shippo.getRate('rate/1')).resolves.toMatchObject({
      id: 'rate_1',
      amountCents: 758,
      estimatedDays: null,
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.goshippo.com/rates/rate%2F1');
  });

  it('refuses a rate it cannot use', async () => {
    const { shippo } = shippoWith(() => json(rate({ currency: 'EUR' })));
    await expect(shippo.getRate('rate_1')).rejects.toThrow('Unexpected answer from Shippo');
  });
});

describe('createShippo: failures', () => {
  it('reports an error status', async () => {
    const { shippo } = shippoWith(() => json({ detail: 'Invalid token' }, 401));
    const err = await shippo.getRate('rate_1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShippingProviderError);
    expect(err).toMatchObject({ status: 401, message: 'Shippo answered 401' });
  });

  it('reports a network failure', async () => {
    const { shippo } = shippoWith(() => {
      throw new TypeError('fetch failed');
    });
    const err = await shippo.getRate('rate_1').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: null, message: 'Shippo could not be reached' });
  });
});

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
const FROM: PostalAddress = {
  ...TO,
  name: 'Studio',
  street2: 'Unit 2',
  email: 'studio@example.com',
  phone: '212-555-0100',
};

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
    // USPS needs the sender's contact details to make the label later.
    expect(body.address_from).toMatchObject({
      email: 'studio@example.com',
      phone: '212-555-0100',
    });
    expect(body.address_to.country).toBe('US');
    expect(body.address_to).not.toHaveProperty('email');
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

describe('createShippo: labels', () => {
  const transaction = (overrides: Record<string, unknown> = {}) => ({
    object_id: 'txn_1',
    status: 'SUCCESS',
    tracking_number: '9400111',
    tracking_url_provider: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111',
    label_url: 'https://deliver.goshippo.com/label.pdf?Expires=1',
    messages: [],
    ...overrides,
  });

  it('buys a rate as a letter-size PDF, synchronously', async () => {
    const { shippo, fetchImpl } = shippoWith(() => json(transaction(), 201));

    await expect(shippo.buyLabel('rate_1', 'Commission #7')).resolves.toEqual({
      ok: true,
      transactionId: 'txn_1',
      trackingNumber: '9400111',
      trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111',
    });
    const [url, init = {}] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.goshippo.com/transactions/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      rate: 'rate_1',
      label_file_type: 'PDF',
      metadata: 'Commission #7',
      async: false,
    });
  });

  it("returns the carrier's reasons when the label wasn't made", async () => {
    const { shippo } = shippoWith(() =>
      json(
        transaction({
          status: 'ERROR',
          tracking_number: null,
          messages: [{ source: 'USPS', code: 'x', text: ' Address not found ' }, { text: '' }],
        }),
        201,
      ),
    );
    await expect(shippo.buyLabel('rate_1', 'n')).resolves.toEqual({
      ok: false,
      messages: ['Address not found'],
    });
  });

  it('drops a tracking link that is not https, and refuses an answer without a number', async () => {
    const { shippo } = shippoWith(() => json(transaction({ tracking_url_provider: 'http://x' })));
    expect(await shippo.buyLabel('rate_1', 'n')).toMatchObject({ trackingUrl: null });

    const { shippo: noNumber } = shippoWith(() => json(transaction({ tracking_number: ' ' })));
    await expect(noNumber.buyLabel('rate_1', 'n')).rejects.toBeInstanceOf(ShippingProviderError);
    const { shippo: garbled } = shippoWith(() => json({ nope: true }));
    await expect(garbled.buyLabel('rate_1', 'n')).rejects.toBeInstanceOf(ShippingProviderError);
  });

  it('reads a fresh link to the label PDF', async () => {
    const { shippo, fetchImpl } = shippoWith(() => json(transaction()));
    await expect(shippo.labelFileUrl('txn/1')).resolves.toBe(
      'https://deliver.goshippo.com/label.pdf?Expires=1',
    );
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.goshippo.com/transactions/txn%2F1');

    const { shippo: none } = shippoWith(() => json(transaction({ label_url: null })));
    await expect(none.labelFileUrl('txn_1')).rejects.toBeInstanceOf(ShippingProviderError);
  });

  it('asks for a refund and reads its status', async () => {
    const { shippo, fetchImpl } = shippoWith((url) =>
      json({ object_id: 'ref_1', status: url.endsWith('/refunds/') ? 'QUEUED' : 'SUCCESS' }),
    );
    await expect(shippo.requestRefund('txn_1')).resolves.toEqual({ id: 'ref_1', status: 'queued' });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))).toEqual({
      transaction: 'txn_1',
      async: false,
    });
    await expect(shippo.getRefund('ref_1')).resolves.toEqual({ id: 'ref_1', status: 'success' });
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.goshippo.com/refunds/ref_1');
  });

  it('refuses a refund answer it does not understand', async () => {
    const { shippo } = shippoWith(() => json({ object_id: 'ref_1', status: 'MAYBE' }));
    await expect(shippo.requestRefund('txn_1')).rejects.toBeInstanceOf(ShippingProviderError);
    await expect(shippo.getRefund('ref_1')).rejects.toBeInstanceOf(ShippingProviderError);
  });
});

describe('createShippo: track', () => {
  it('reads where a package is, with every scan', async () => {
    const { shippo, fetchImpl } = shippoWith(() =>
      json({
        carrier: 'usps',
        tracking_number: '9400111',
        eta: '2026-12-04T00:00:00Z',
        tracking_status: {
          status: 'TRANSIT',
          status_details: ' Arrived at USPS facility ',
          status_date: '2026-12-02T09:00:00Z',
        },
        tracking_history: [
          {
            object_id: 'e1',
            status: 'PRE_TRANSIT',
            status_details: 'Label created',
            status_date: '2026-12-01T09:00:00Z',
            location: null,
          },
          {
            object_id: 'e2',
            status: 'TRANSIT',
            status_details: 'Arrived',
            status_date: '2026-12-02T09:00:00Z',
            location: { city: 'Kearny', state: 'NJ', zip: '07032', country: 'US' },
          },
          { status: 'TRANSIT' }, // no ID: skipped
        ],
      }),
    );

    await expect(shippo.track('usps', '9400 111')).resolves.toEqual({
      status: 'transit',
      details: 'Arrived at USPS facility',
      updatedAt: new Date('2026-12-02T09:00:00Z'),
      eta: new Date('2026-12-04T00:00:00Z'),
      scans: [
        {
          id: 'e1',
          status: 'pre_transit',
          details: 'Label created',
          occurredAt: new Date('2026-12-01T09:00:00Z'),
          city: null,
          state: null,
        },
        {
          id: 'e2',
          status: 'transit',
          details: 'Arrived',
          occurredAt: new Date('2026-12-02T09:00:00Z'),
          city: 'Kearny',
          state: 'NJ',
        },
      ],
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://api.goshippo.com/tracks/usps/9400%20111');
  });

  it('treats missing, new, or garbled values as unknown', async () => {
    const { shippo } = shippoWith(() =>
      json({
        eta: 'not a date',
        tracking_status: null,
        tracking_history: [{ object_id: 'e1', status: 'TELEPORTED', status_date: 5 }],
      }),
    );
    await expect(shippo.track('usps', '1')).resolves.toEqual({
      status: 'unknown',
      details: null,
      updatedAt: null,
      eta: null,
      scans: [
        { id: 'e1', status: 'unknown', details: null, occurredAt: null, city: null, state: null },
      ],
    });

    const { shippo: broken } = shippoWith(() => json({ tracking_history: 'nope' }));
    await expect(broken.track('usps', '1')).rejects.toBeInstanceOf(ShippingProviderError);
  });
});

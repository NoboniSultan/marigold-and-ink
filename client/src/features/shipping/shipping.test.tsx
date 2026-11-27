/** Shipping a physical commission (milestone 11): the client's page and the admin's section. */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  LabelOption,
  Shipment,
  ShippingLabel,
  ShippingMeta,
  ShippingOption,
} from '@shared/types/shipping.ts';
import type { Call, MockResponse } from '../../test/utils.tsx';
import { USER, mockApi, renderRoute } from '../../test/utils.tsx';

const COMMISSION = {
  id: 7,
  clientId: USER.id,
  size: 'A3',
  medium: 'ink',
  subjectCount: 1,
  fulfillmentType: 'physical',
  isRush: false,
  notes: null,
  status: 'awaiting_final_payment',
  revisionCount: 0,
  revisionLimit: 2,
  quotedTotalCents: 10000,
  depositCents: 5000,
  balanceCents: 5000,
  createdAt: '2026-11-24T12:00:00.000Z',
  updatedAt: '2026-11-24T12:00:00.000Z',
  availableTransitions: [],
};

const META: ShippingMeta = {
  shippingEnabled: true,
  ships: true,
  addressOpen: true,
  choosingOpen: true,
  labelOpen: false,
};

const ADDRESS = {
  name: 'Ana Client',
  line1: '215 CLAYTON ST',
  line2: null,
  city: 'SAN FRANCISCO',
  state: 'CA',
  postalCode: '94117-1913',
};
const PACKAGE = { weightOz: 12, lengthIn: 18, widthIn: 14, heightIn: 0.5 };

const OPTIONS: ShippingOption[] = [
  {
    rateId: 'rate_ground',
    carrier: 'USPS',
    serviceName: 'Ground Advantage',
    estimatedDays: 4,
    postageCents: 758,
    packagingFeeCents: 333,
    totalCents: 1091,
  },
  {
    rateId: 'rate_priority',
    carrier: 'USPS',
    serviceName: 'Priority Mail',
    estimatedDays: 1,
    postageCents: 1210,
    packagingFeeCents: 333,
    totalCents: 1543,
  },
];

function api({
  user = USER as typeof USER,
  commission = COMMISSION as typeof COMMISSION,
  shipment = null as Shipment | null,
  meta = META,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return { body: { data: user } };
    if (call.path === `/commissions/${commission.id}`) return { body: { data: commission } };
    if (call.path === `/commissions/${commission.id}/payments`) {
      return { body: { data: [], meta: { paymentsEnabled: true, currency: 'usd' } } };
    }
    if (call.path === `/commissions/${commission.id}/files`) {
      return {
        body: {
          data: [],
          meta: {
            filesEnabled: false,
            referencesOpen: false,
            referenceLimit: 10,
            referenceMaxBytes: 1,
            previewMaxBytes: 1,
            finalMaxBytes: 1,
          },
        },
      };
    }
    if (call.path === `/commissions/${commission.id}/shipping` && call.method === 'GET') {
      return { body: { data: shipment, meta } };
    }
    return undefined;
  });
}

const shipmentWith = (overrides: Partial<Shipment> = {}): Shipment => ({
  address: ADDRESS,
  addressRemovedAt: null,
  package: PACKAGE,
  chosen: null,
  label: null,
  voidedLabels: [],
  ...overrides,
});

const LABEL: ShippingLabel = {
  carrier: 'USPS',
  serviceName: 'Ground Advantage',
  trackingNumber: '9400111',
  trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111',
  trackingStatus: 'transit',
  trackingDetails: 'Arrived at USPS Regional Facility',
  trackingUpdatedAt: '2026-12-02T09:00:00.000Z',
  eta: '2026-12-04T12:00:00.000Z',
  createdAt: '2026-12-01T09:00:00.000Z',
  events: [
    {
      status: 'transit',
      details: 'Arrived at USPS Regional Facility',
      occurredAt: '2026-12-02T09:00:00.000Z',
      city: 'Kearny',
      state: 'NJ',
    },
    {
      status: 'pre_transit',
      details: null,
      occurredAt: '2026-12-01T09:00:00.000Z',
      city: null,
      state: null,
    },
  ],
  postageCents: null,
  voidable: false,
};

describe("the client's commission page", () => {
  it('asks for the address after the deposit, and saves it', async () => {
    const user = userEvent.setup();
    let shipment: Shipment | null = null;
    const calls = mockApiFor(() => shipment, {
      status: 'in_progress',
      meta: { ...META, choosingOpen: false },
      extra: (call) => {
        if (call.path === '/commissions/7/shipping/address') {
          shipment = shipmentWith({ package: null });
          return { body: { data: shipment } };
        }
        return undefined;
      },
    });
    renderRoute('/commissions/7');

    const form = await screen.findByRole('form', { name: 'Shipping address' });
    await user.type(within(form).getByLabelText('Full name'), 'Ana Client');
    await user.type(within(form).getByLabelText('Street address'), '215 Clayton St');
    await user.type(within(form).getByLabelText('City'), 'San Francisco');
    await user.selectOptions(within(form).getByLabelText('State'), 'CA');
    await user.type(within(form).getByLabelText('ZIP code'), '94117');
    await user.click(within(form).getByRole('button', { name: 'Save address' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        name: 'Ana Client',
        line1: '215 Clayton St',
        line2: null,
        city: 'San Francisco',
        state: 'CA',
        postalCode: '94117',
      }),
    );
    expect(await screen.findByText(/215 CLAYTON ST/)).toBeInTheDocument();
    expect(
      screen.getByText(/choose a shipping option when the balance is due/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change address' })).toBeInTheDocument();
  });

  it("shows the carrier's reasons when an address is refused", async () => {
    const user = userEvent.setup();
    api({
      meta: { ...META, choosingOpen: false },
      commission: { ...COMMISSION, status: 'in_progress' },
      extra: (call) =>
        call.method === 'PUT'
          ? {
              status: 422,
              body: {
                error: {
                  code: 'ADDRESS_NOT_DELIVERABLE',
                  message: "That address couldn't be confirmed as deliverable.",
                  details: { messages: ['Address not found'] },
                },
              },
            }
          : undefined,
    });
    renderRoute('/commissions/7');

    const form = await screen.findByRole('form', { name: 'Shipping address' });
    await user.click(within(form).getByRole('button', { name: 'Save address' }));

    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent('Address not found');
  });

  it('holds the balance until shipping is chosen, then charges both together', async () => {
    const user = userEvent.setup();
    let shipment = shipmentWith();
    const calls = mockApiFor(() => shipment, {
      extra: (call) => {
        if (call.path === '/commissions/7/shipping/options') return { body: { data: OPTIONS } };
        if (call.path === '/commissions/7/shipping/choice') {
          const { rateId: _r, ...chosen } = OPTIONS[1]!;
          shipment = shipmentWith({ chosen });
          return { body: { data: shipment } };
        }
        return undefined;
      },
    });
    renderRoute('/commissions/7');

    expect(
      await screen.findByText('Choose a shipping option below to pay the balance.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Pay/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'See shipping options' }));
    const options = await screen.findByRole('group', { name: 'Choose shipping' });
    const ground = within(options).getByRole('radio', { name: /Ground Advantage/ });
    expect(ground).toBeChecked(); // the cheapest is preselected
    expect(within(options).getByText(/about 4 business days/)).toBeInTheDocument();
    await user.click(within(options).getByRole('radio', { name: /Priority Mail/ }));
    await user.click(screen.getByRole('button', { name: 'Use this option' }));

    await waitFor(() =>
      expect(calls.find((c) => c.path === '/commissions/7/shipping/choice')?.body).toEqual({
        rateId: 'rate_priority',
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Pay balance and shipping ($65.43)' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/USPS Priority Mail, about 1 business day\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change shipping option' })).toBeInTheDocument();
  });

  it('says prices come once the package is in', async () => {
    api({ shipment: shipmentWith({ package: null }) });
    renderRoute('/commissions/7');
    expect(await screen.findByText(/adding the package details/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See shipping options' })).not.toBeInTheDocument();
  });

  it('says shipping opens soon while it is switched off', async () => {
    api({ meta: { ...META, shippingEnabled: false } });
    renderRoute('/commissions/7');
    expect(await screen.findByText('Shipping options open soon.')).toBeInTheDocument();
    expect(screen.queryByText(/Choose a shipping option below/)).not.toBeInTheDocument();
  });

  it('shows the tracking number, where the package is, and its scans', async () => {
    const { rateId: _r, ...chosen } = OPTIONS[0]!;
    api({
      commission: { ...COMMISSION, status: 'shipped' },
      shipment: shipmentWith({ chosen, label: LABEL }),
      meta: { ...META, addressOpen: false, choosingOpen: false },
    });
    renderRoute('/commissions/7');

    const link = await screen.findByRole('link', { name: '9400111' });
    expect(link).toHaveAttribute('href', LABEL.trackingUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('On its way')).toBeInTheDocument();
    expect(screen.getByText(/Expected by Dec 4, 2026/)).toBeInTheDocument();
    const history = screen.getByRole('list', { name: 'Tracking history' });
    const items = within(history).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Arrived at USPS Regional Facility (Kearny, NJ)');
    expect(items[1]).toHaveTextContent('Label created, waiting for the carrier');
    expect(screen.queryByRole('button', { name: 'Void label' })).not.toBeInTheDocument();
  });

  it('never asks about shipping for work delivered as files', async () => {
    const calls = api({ commission: { ...COMMISSION, fulfillmentType: 'mixed_media' } });
    renderRoute('/commissions/7');

    expect(await screen.findByRole('button', { name: 'Pay balance ($50.00)' })).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/shipping'))).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Shipping' })).not.toBeInTheDocument();
  });
});

describe('the admin commission page', () => {
  const ADMIN = { ...USER, id: 1, role: 'admin' as const };
  const adminDetails = (status = 'in_progress') => ({
    body: {
      data: {
        commission: { ...COMMISSION, status, availableTransitions: [] },
        client: { id: USER.id, displayName: 'Ana', email: 'ana@example.com' },
        money: {
          paidCents: 0,
          refundedCents: 0,
          withheldForTreesCents: 0,
          refundableCents: 0,
          treeMoneyRefundedCents: 0,
          trees: null,
        },
      },
    },
  });

  it('enters the package, and shows the address and the client’s choice', async () => {
    const user = userEvent.setup();
    const { rateId: _r, ...chosen } = OPTIONS[0]!;
    const calls = api({
      user: ADMIN,
      shipment: shipmentWith({ package: null, chosen: null }),
      meta: { ...META, choosingOpen: false },
      extra: (call) => {
        if (call.path === '/admin/commissions/7') return adminDetails();
        if (call.path === '/commissions/7/quote') {
          return { status: 404, body: { error: { code: 'QUOTE_NOT_FOUND', message: 'No quote' } } };
        }
        if (call.path === '/admin/commissions/7/shipping/package') {
          return { body: { data: shipmentWith({ chosen }) } };
        }
        return undefined;
      },
    });
    renderRoute('/admin/commissions/7');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    expect(within(section).getByText(/215 CLAYTON ST/)).toBeInTheDocument();
    expect(within(section).getByText(/client chooses once the balance is due/)).toBeInTheDocument();

    const form = within(section).getByRole('form', { name: 'Package' });
    await user.type(within(form).getByLabelText('Weight (ounces, packed)'), '12');
    await user.type(within(form).getByLabelText('Length (inches)'), '18');
    await user.type(within(form).getByLabelText('Width (inches)'), '14');
    await user.type(within(form).getByLabelText('Height (inches)'), '0.5');
    await user.click(within(form).getByRole('button', { name: 'Save package' }));

    await waitFor(() =>
      expect(calls.find((c) => c.path === '/admin/commissions/7/shipping/package')?.body).toEqual(
        PACKAGE,
      ),
    );
    expect(await within(section).findByRole('status')).toHaveTextContent('Saved');
  });

  it('shows a removed address and the package once shipping is settled', async () => {
    const { rateId: _r, ...chosen } = OPTIONS[0]!;
    api({
      user: ADMIN,
      shipment: shipmentWith({
        address: null,
        addressRemovedAt: '2026-11-25T00:00:00.000Z',
        chosen,
      }),
      meta: { ...META, addressOpen: false, choosingOpen: false },
      extra: (call) => {
        if (call.path === '/admin/commissions/7') return adminDetails('completed');
        if (call.path === '/commissions/7/quote') {
          return { status: 404, body: { error: { code: 'QUOTE_NOT_FOUND', message: 'No quote' } } };
        }
        return undefined;
      },
    });
    renderRoute('/admin/commissions/7');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    expect(within(section).getByText(/client deleted their account/)).toBeInTheDocument();
    expect(within(section).getByText('Package: 12 oz, 18 × 14 × 0.5 in')).toBeInTheDocument();
    expect(
      within(section).getByText(/USPS Ground Advantage, about 4 business days\./),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('form', { name: 'Package' })).not.toBeInTheDocument();
  });

  const LABEL_OPTIONS: LabelOption[] = [
    {
      rateId: 'rate_ground_now',
      carrier: 'USPS',
      serviceName: 'Ground Advantage',
      estimatedDays: 4,
      postageCents: 790,
      paidPostageCents: 758,
      matchesChoice: true,
    },
    {
      rateId: 'rate_priority_now',
      carrier: 'USPS',
      serviceName: 'Priority Mail',
      estimatedDays: 2,
      postageCents: 1210,
      paidPostageCents: null,
      matchesChoice: false,
    },
  ];

  function readyToShip(extra: (call: Call) => MockResponse | undefined, shipment: Shipment) {
    return api({
      user: ADMIN,
      commission: { ...COMMISSION, status: 'ready_to_ship' },
      shipment,
      meta: { ...META, addressOpen: false, choosingOpen: false, labelOpen: !shipment.label },
      extra: (call) => {
        if (call.path === '/admin/commissions/7') return adminDetails('ready_to_ship');
        if (call.path === '/commissions/7/quote') {
          return { status: 404, body: { error: { code: 'QUOTE_NOT_FOUND', message: 'No quote' } } };
        }
        return extra(call);
      },
    });
  }

  it("buys the label for the client's service, showing what the owner covers", async () => {
    const user = userEvent.setup();
    const { rateId: _r, ...chosen } = OPTIONS[0]!;
    const bought = shipmentWith({
      chosen,
      label: { ...LABEL, trackingStatus: 'unknown', events: [], postageCents: 790, voidable: true },
    });
    const calls = readyToShip((call) => {
      if (call.path === '/admin/commissions/7/shipping/label-options') {
        return { body: { data: LABEL_OPTIONS } };
      }
      if (call.path === '/admin/commissions/7/shipping/label') {
        return {
          body: { data: bought, meta: { ...META, addressOpen: false, choosingOpen: false } },
        };
      }
      return undefined;
    }, shipmentWith({ chosen }));
    renderRoute('/admin/commissions/7');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    await user.click(within(section).getByRole('button', { name: 'Get label prices' }));
    const options = await within(section).findByRole('group', { name: 'Postage today' });
    const ground = within(options).getByRole('radio', { name: /Ground Advantage/ });
    expect(ground).toBeChecked(); // the client's choice is preselected
    expect(within(options).getByText(/client paid \$7\.58; you cover \$0\.32/)).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Buy label' }));

    await waitFor(() =>
      expect(calls.find((c) => c.path === '/admin/commissions/7/shipping/label')?.body).toEqual({
        rateId: 'rate_ground_now',
      }),
    );
    const print = await within(section).findByRole('link', { name: 'Print label (PDF)' });
    expect(print).toHaveAttribute('href', '/api/v1/admin/commissions/7/shipping/label/file');
    expect(within(section).getByText(/for \$7\.90 postage/)).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Void label' })).toBeInTheDocument();
  });

  it("shows the carrier's reasons when a label can't be made", async () => {
    const user = userEvent.setup();
    readyToShip((call) => {
      if (call.path === '/admin/commissions/7/shipping/label-options') {
        return { body: { data: LABEL_OPTIONS } };
      }
      if (call.path === '/admin/commissions/7/shipping/label') {
        return {
          status: 422,
          body: {
            error: {
              code: 'LABEL_FAILED',
              message: "The carrier couldn't make this label",
              details: { messages: ['Address not found'] },
            },
          },
        };
      }
      return undefined;
    }, shipmentWith());
    renderRoute('/admin/commissions/7');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    await user.click(within(section).getByRole('button', { name: 'Get label prices' }));
    await user.click(await within(section).findByRole('button', { name: 'Buy label' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Address not found');
  });

  it('voids a label after confirming, and lists it with its refund', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const voided = shipmentWith({
      voidedLabels: [
        {
          trackingNumber: '9400111',
          postageCents: 790,
          voidedAt: '2026-12-01T10:00:00.000Z',
          refundStatus: 'queued',
        },
      ],
    });
    const calls = readyToShip(
      (call) =>
        call.path === '/admin/commissions/7/shipping/label/void'
          ? { body: { data: voided, meta: { ...META, labelOpen: true } } }
          : undefined,
      shipmentWith({
        label: { ...LABEL, trackingStatus: 'unknown', postageCents: 790, voidable: true },
      }),
    );
    renderRoute('/admin/commissions/7');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    await user.click(await within(section).findByRole('button', { name: 'Void label' }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.some((c) => c.path === '/admin/commissions/7/shipping/label/void')).toBe(true),
    );
    expect(await within(section).findByText(/9400111: \$7\.90, voided/)).toHaveTextContent(
      'refund requested',
    );
    expect(within(section).getByRole('button', { name: 'Get label prices' })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('checks tracking on request', async () => {
    const user = userEvent.setup();
    const calls = readyToShip(
      (call) =>
        call.path === '/admin/commissions/7/shipping/tracking/refresh'
          ? {
              body: {
                data: shipmentWith({ label: { ...LABEL, trackingStatus: 'delivered' } }),
                meta: { ...META, addressOpen: false, choosingOpen: false },
              },
            }
          : undefined,
      shipmentWith({ label: { ...LABEL, postageCents: 790 } }),
    );
    renderRoute('/admin/commissions/7');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    await user.click(await within(section).findByRole('button', { name: 'Check tracking now' }));
    expect(await within(section).findByText('Delivered')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/tracking/refresh'))).toBe(
      true,
    );
  });
});

/** Like api(), with the shipment read fresh on every request (so saves show up). */
function mockApiFor(
  current: () => Shipment | null,
  {
    status = 'awaiting_final_payment',
    meta = META,
    extra = (_call: Call): MockResponse | undefined => undefined,
  }: {
    status?: string;
    meta?: ShippingMeta;
    extra?: (call: Call) => MockResponse | undefined;
  } = {},
) {
  return api({
    commission: { ...COMMISSION, status },
    meta,
    extra: (call) =>
      extra(call) ??
      (call.path === '/commissions/7/shipping' && call.method === 'GET'
        ? { body: { data: current(), meta } }
        : undefined),
  });
}

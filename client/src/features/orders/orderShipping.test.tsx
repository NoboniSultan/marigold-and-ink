/** Shipping shop orders (milestone 12c): the cart's shipping step, orders, admin, packing. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  AdminOrder,
  CartPreview,
  CartShippingQuote,
  Order,
  PricedLine,
} from '@shared/types/order.ts';
import type { Shipment } from '@shared/types/shipping.ts';
import type { Call, MockResponse } from '../../test/utils.tsx';
import { USER, mockApi, page, renderRoute } from '../../test/utils.tsx';

vi.mock('../cart/goTo.ts', () => ({ goTo: vi.fn() }));
const { goTo } = await import('../cart/goTo.ts');

const ADMIN = { ...USER, id: 1, role: 'admin' as const };

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('marigold-cart-v1', JSON.stringify([{ variantId: 11, quantity: 2 }]));
  vi.mocked(goTo).mockClear();
});

const LINE: PricedLine = {
  variantId: 11,
  productSlug: 'marigold-stickers',
  productName: 'Marigold Stickers',
  variantName: 'Single',
  unitPriceCents: 400,
  quantity: 2,
  lineCents: 800,
  available: 5,
  ok: true,
  photo: null,
};

const preview = (delivery: CartPreview['delivery']): CartPreview => ({
  lines: [LINE],
  unavailable: [],
  subtotalCents: 800,
  currency: 'usd',
  ready: true,
  delivery,
});

const STANDARD = {
  name: 'Ana Client',
  line1: '215 CLAYTON ST',
  line2: null,
  city: 'SAN FRANCISCO',
  state: 'CA',
  postalCode: '94117-1913',
};

const QUOTE: CartShippingQuote = {
  address: STANDARD,
  options: [
    {
      serviceToken: 'usps_ground_advantage',
      carrier: 'USPS',
      serviceName: 'Ground Advantage',
      estimatedDays: 4,
      postageCents: 735,
      packagingFeeCents: 400,
      totalCents: 1135,
    },
    {
      serviceToken: 'usps_priority',
      carrier: 'USPS',
      serviceName: 'Priority Mail',
      estimatedDays: 2,
      postageCents: 1369,
      packagingFeeCents: 400,
      totalCents: 1769,
    },
  ],
};

function api({
  user = USER as typeof USER | typeof ADMIN,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return { body: { data: user } };
    if (call.path === '/shop') return { body: { data: { open: true } } };
    return undefined;
  });
}

describe("the cart's shipping step", () => {
  it('fills in the last address, prices the options, and checks out with the chosen one', async () => {
    const user = userEvent.setup();
    const calls = api({
      extra: (call) => {
        if (call.path === '/cart/preview') return { body: { data: preview('ship') } };
        if (call.path === '/orders/address') return { body: { data: STANDARD } };
        if (call.path === '/cart/shipping-options') return { body: { data: QUOTE } };
        if (call.path === '/orders' && call.method === 'POST') {
          return {
            status: 201,
            body: { data: { orderId: 42, url: 'https://checkout.stripe.com/c' } },
          };
        }
        return undefined;
      },
    });
    renderRoute('/cart');

    const form = await screen.findByRole('form', { name: 'Shipping address' });
    await waitFor(() =>
      expect(within(form).getByLabelText('Street address')).toHaveValue('215 CLAYTON ST'),
    );
    expect(screen.getByRole('button', { name: 'Check out' })).toBeDisabled(); // no option yet

    await user.click(within(form).getByRole('button', { name: 'See shipping options' }));
    const choices = await screen.findByRole('group', { name: 'Choose shipping' });
    expect(within(choices).getByRole('radio', { name: /Ground Advantage/ })).toBeChecked();
    await user.click(within(choices).getByRole('radio', { name: /Priority Mail/ }));
    expect(screen.getByText('$17.69', { selector: 'p span' })).toBeInTheDocument();
    expect(screen.getByText('$25.69', { selector: 'p span' })).toBeInTheDocument(); // the total

    await user.click(screen.getByRole('button', { name: 'Check out' }));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith('https://checkout.stripe.com/c'));
    expect(calls.find((c) => c.path === '/cart/shipping-options')?.body).toMatchObject({
      items: [{ variantId: 11, quantity: 2 }],
      address: { line1: '215 CLAYTON ST', postalCode: '94117-1913' },
    });
    expect(calls.find((c) => c.path === '/orders' && c.method === 'POST')?.body).toEqual({
      items: [{ variantId: 11, quantity: 2 }],
      shipping: { address: STANDARD, serviceToken: 'usps_priority', expectedCents: 1769 },
    });
  });

  it("shows the carrier's reasons for an address, and asks again when the price changed", async () => {
    const user = userEvent.setup();
    let firstTry = true;
    api({
      extra: (call) => {
        if (call.path === '/cart/preview') return { body: { data: preview('ship') } };
        if (call.path === '/orders/address') return { body: { data: STANDARD } };
        if (call.path === '/cart/shipping-options') {
          if (firstTry) {
            firstTry = false;
            return {
              status: 422,
              body: {
                error: {
                  code: 'ADDRESS_NOT_DELIVERABLE',
                  message: "That address couldn't be confirmed as deliverable.",
                  details: { messages: ['Address not found'] },
                },
              },
            };
          }
          return { body: { data: QUOTE } };
        }
        if (call.path === '/orders') {
          return {
            status: 409,
            body: {
              error: { code: 'SHIPPING_PRICE_CHANGED', message: 'The shipping price has changed.' },
            },
          };
        }
        return undefined;
      },
    });
    renderRoute('/cart');

    const form = await screen.findByRole('form', { name: 'Shipping address' });
    await waitFor(() => expect(within(form).getByLabelText('City')).toHaveValue('SAN FRANCISCO'));
    await user.click(within(form).getByRole('button', { name: 'See shipping options' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Address not found');

    await user.click(within(form).getByRole('button', { name: 'See shipping options' }));
    await screen.findByRole('group', { name: 'Choose shipping' });
    await user.click(screen.getByRole('button', { name: 'Check out' }));

    expect(await screen.findByText('The shipping price has changed.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Choose shipping' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check out' })).toBeDisabled();
  });

  it('skips shipping for a pickup, and blocks a cart that cannot ship yet', async () => {
    const user = userEvent.setup();
    let delivery: CartPreview['delivery'] = 'pickup';
    const calls = api({
      extra: (call) => {
        if (call.path === '/cart/preview') return { body: { data: preview(delivery) } };
        if (call.path === '/orders' && call.method === 'POST') {
          return {
            status: 201,
            body: { data: { orderId: 42, url: 'https://checkout.stripe.com/c' } },
          };
        }
        return undefined;
      },
    });
    const view = renderRoute('/cart');
    expect(await screen.findByText(/Local pickup\./)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Shipping address' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check out' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/orders')?.body).toEqual({
        items: [{ variantId: 11, quantity: 2 }],
      }),
    );
    view.unmount();

    delivery = 'unavailable';
    api({
      extra: (call) =>
        call.path === '/cart/preview' ? { body: { data: preview('unavailable') } } : undefined,
    });
    renderRoute('/cart');
    expect(await screen.findByText(/can't be shipped yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check out' })).toBeDisabled();
  });
});

const SHIPMENT: Shipment = {
  address: STANDARD,
  addressRemovedAt: null,
  package: { weightOz: 1, lengthIn: 9.5, widthIn: 6.5, heightIn: 0.5 },
  chosen: {
    carrier: 'USPS',
    serviceName: 'Ground Advantage',
    estimatedDays: 4,
    postageCents: 735,
    packagingFeeCents: 400,
    totalCents: 1135,
  },
  label: null,
  voidedLabels: [],
};

const ORDER: Order = {
  id: 42,
  status: 'shipped',
  items: [
    {
      variantId: 11,
      productName: 'Marigold Stickers',
      variantName: 'Single',
      unitPriceCents: 400,
      quantity: 2,
      lineCents: 800,
    },
  ],
  subtotalCents: 800,
  shippingCents: 1135,
  totalCents: 1935,
  pickup: false,
  shipment: {
    ...SHIPMENT,
    label: {
      carrier: 'USPS',
      serviceName: 'Ground Advantage',
      trackingNumber: '9400111',
      trackingUrl: 'https://tools.usps.com/x',
      trackingStatus: 'transit',
      trackingDetails: null,
      trackingUpdatedAt: null,
      eta: null,
      createdAt: '2026-11-27T12:00:00.000Z',
      events: [],
      postageCents: null,
      voidable: false,
    },
  },
  currency: 'usd',
  refundedCents: 0,
  checkoutUrl: null,
  checkoutExpiresAt: null,
  paidAt: '2026-11-27T11:00:00.000Z',
  createdAt: '2026-11-27T10:55:00.000Z',
};

describe('an order page', () => {
  it('shows shipping in the total, where it goes, and its tracking', async () => {
    api({ extra: (call) => (call.path === '/orders/42' ? { body: { data: ORDER } } : undefined) });
    renderRoute('/orders/42');

    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Shipping & packaging$11.35');
    expect(table).toHaveTextContent('Total$19.35');
    const shipping = screen.getByRole('region', { name: 'Shipping' });
    expect(shipping).toHaveTextContent('215 CLAYTON ST');
    expect(within(shipping).getByRole('link', { name: '9400111' })).toBeInTheDocument();
  });
});

describe('the admin order page', () => {
  const adminOrder = (overrides: Partial<AdminOrder> = {}): AdminOrder => ({
    ...ORDER,
    status: 'paid',
    shipment: SHIPMENT,
    client: { id: 7, displayName: 'Ana', email: 'ana@example.com' },
    events: [],
    refunds: [],
    refundable: true,
    refundableCents: ORDER.totalCents,
    trees: null,
    labelOpen: true,
    manualMoves: ['shipped'],
    ...overrides,
  });

  it("buys the order's label and marks it shipped by hand", async () => {
    const user = userEvent.setup();
    const calls = api({
      user: ADMIN,
      extra: (call) => {
        if (call.path === '/admin/orders/42' && call.method === 'GET')
          return { body: { data: adminOrder() } };
        if (call.path === '/admin/orders/42/shipping/label-options') {
          return {
            body: {
              data: [
                {
                  rateId: 'rate_1',
                  carrier: 'USPS',
                  serviceName: 'Ground Advantage',
                  estimatedDays: 4,
                  postageCents: 735,
                  paidPostageCents: 735,
                  matchesChoice: true,
                },
              ],
            },
          };
        }
        if (call.path === '/admin/orders/42/shipping/label') {
          return { body: { data: adminOrder({ labelOpen: false, shipment: ORDER.shipment }) } };
        }
        if (call.path === '/admin/orders/42/status') {
          return {
            body: {
              data: adminOrder({
                status: 'shipped',
                labelOpen: false,
                manualMoves: ['delivered'],
                shipment: ORDER.shipment,
              }),
            },
          };
        }
        return undefined;
      },
    });
    renderRoute('/admin/orders/42');

    const section = await screen.findByRole('region', { name: 'Shipping' });
    expect(section).toHaveTextContent('Package: 1 oz, 9.5 × 6.5 × 0.5 in');
    await user.click(within(section).getByRole('button', { name: 'Get label prices' }));
    await user.click(await within(section).findByRole('button', { name: 'Buy label' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/shipping/label'))?.body).toEqual({
        rateId: 'rate_1',
      }),
    );
    expect(await within(section).findByRole('link', { name: 'Print label (PDF)' })).toHaveAttribute(
      'href',
      '/api/v1/admin/orders/42/shipping/label/file',
    );

    await user.click(within(section).getByRole('button', { name: 'Mark shipped' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/status'))?.body).toEqual({ toStatus: 'shipped' }),
    );
    expect(
      await within(section).findByRole('button', { name: 'Mark delivered' }),
    ).toBeInTheDocument();
  });

  it('marks a pickup collected', async () => {
    const user = userEvent.setup();
    const calls = api({
      user: ADMIN,
      extra: (call) => {
        if (call.path === '/admin/orders/42' && call.method === 'GET') {
          return {
            body: {
              data: adminOrder({
                pickup: true,
                shipment: null,
                shippingCents: 0,
                totalCents: 800,
                labelOpen: false,
                manualMoves: ['delivered'],
              }),
            },
          };
        }
        if (call.path === '/admin/orders/42/status') {
          return {
            body: {
              data: adminOrder({
                pickup: true,
                shipment: null,
                status: 'delivered',
                manualMoves: [],
                labelOpen: false,
              }),
            },
          };
        }
        return undefined;
      },
    });
    renderRoute('/admin/orders/42');
    const section = await screen.findByRole('region', { name: 'Local pickup' });
    await user.click(within(section).getByRole('button', { name: 'Mark picked up' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/status'))?.body).toEqual({
        toStatus: 'delivered',
      }),
    );
  });
});

describe('packing types (admin)', () => {
  it('adds a mailer', async () => {
    const user = userEvent.setup();
    const calls = api({
      user: ADMIN,
      extra: (call) => {
        if (call.path === '/admin/shop/products') return page([]);
        if (call.path === '/admin/shop/packing-types' && call.method === 'GET')
          return { body: { data: [] } };
        if (call.path === '/admin/shop/packing-types' && call.method === 'POST') {
          return { status: 201, body: { data: { id: 1, ...(call.body as object) } } };
        }
        return undefined;
      },
    });
    renderRoute('/admin/shop');

    const form = await screen.findByRole('form', { name: 'Add a packing type' });
    await user.type(within(form).getByLabelText('Name'), 'Flat mailer');
    await user.type(within(form).getByLabelText('Length (in)'), '9.5');
    await user.type(within(form).getByLabelText('Width (in)'), '6.5');
    await user.type(within(form).getByLabelText('Height (in)'), '0.5');
    await user.type(within(form).getByLabelText('Empty weight (oz)'), '0.4');
    await user.click(within(form).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        name: 'Flat mailer',
        lengthIn: 9.5,
        widthIn: 6.5,
        heightIn: 0.5,
        weightOz: 0.4,
      }),
    );
  });
});

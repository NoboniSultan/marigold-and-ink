/** The cart, checkout, orders, and the admin's order pages (milestone 12b). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminOrder, CartPreview, Order, PricedLine } from '@shared/types/order.ts';
import type { Product } from '@shared/types/shop.ts';
import type { Call, MockResponse } from '../../test/utils.tsx';
import { SIGNED_OUT, USER, mockApi, page, renderRoute } from '../../test/utils.tsx';

vi.mock('../cart/goTo.ts', () => ({ goTo: vi.fn() }));
const { goTo } = await import('../cart/goTo.ts');

const ADMIN = { ...USER, id: 1, role: 'admin' as const };
const CART_KEY = 'marigold-cart-v1';

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(goTo).mockClear();
});

const photo = {
  id: 1,
  smallUrl: '/media/shop/products/1/0000000000000001-small.webp',
  largeUrl: '/media/shop/products/1/0000000000000001-large.webp',
  width: 1600,
  height: 1200,
  altText: 'Stickers',
};

const PRODUCT: Product = {
  slug: 'marigold-stickers',
  name: 'Marigold Stickers',
  category: 'stickers',
  priceFromCents: 400,
  priceToCents: 1500,
  available: true,
  oneOfAKind: false,
  photo,
  description: '',
  materials: null,
  dimensions: null,
  variants: [
    { id: 11, name: 'Single', priceCents: 400, available: true },
    { id: 12, name: 'Pack of 5', priceCents: 1500, available: true },
  ],
  photos: [photo],
};

const line = (overrides: Partial<PricedLine> = {}): PricedLine => ({
  variantId: 11,
  productSlug: 'marigold-stickers',
  productName: 'Marigold Stickers',
  variantName: 'Single',
  unitPriceCents: 400,
  quantity: 2,
  lineCents: 800,
  available: 5,
  ok: true,
  photo,
  ...overrides,
});

const previewOf = (lines: PricedLine[], unavailable: number[] = []): CartPreview => ({
  lines,
  unavailable,
  subtotalCents: lines.reduce((sum, l) => sum + l.lineCents, 0),
  currency: 'usd',
  ready: lines.length > 0 && unavailable.length === 0 && lines.every((l) => l.ok),
});

const ORDER: Order = {
  id: 42,
  status: 'paid',
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
  currency: 'usd',
  refundedCents: 0,
  checkoutUrl: null,
  checkoutExpiresAt: null,
  paidAt: '2026-11-27T12:00:00.000Z',
  createdAt: '2026-11-27T11:55:00.000Z',
};

function api({
  user = USER as typeof USER | typeof ADMIN | null,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return user ? { body: { data: user } } : SIGNED_OUT;
    if (call.path === '/shop') return { body: { data: { open: true } } };
    if (call.path === '/shop/products/marigold-stickers') return { body: { data: PRODUCT } };
    return undefined;
  });
}

const storeCart = (lines: { variantId: number; quantity: number }[]) =>
  window.localStorage.setItem(CART_KEY, JSON.stringify(lines));
const storedCart = () => JSON.parse(window.localStorage.getItem(CART_KEY) ?? '[]');

describe('adding to the cart', () => {
  it('adds the chosen option and quantity, and shows the cart in the header', async () => {
    const user = userEvent.setup();
    api();
    renderRoute('/shop/marigold-stickers');

    await screen.findByRole('heading', { name: 'Marigold Stickers' });
    await user.click(screen.getByRole('radio', { name: /Pack of 5/ }));
    const quantity = screen.getByLabelText('Quantity');
    await user.clear(quantity);
    await user.type(quantity, '2');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(storedCart()).toEqual([{ variantId: 12, quantity: 2 }]);
    expect(screen.getByRole('status')).toHaveTextContent('Added to your cart.');
    expect(await screen.findByRole('link', { name: 'Cart, 2 items' })).toHaveAttribute(
      'href',
      '/cart',
    );
  });
});

describe('the cart page', () => {
  it('shows each item priced by the server, and changes quantities', async () => {
    const user = userEvent.setup();
    storeCart([{ variantId: 11, quantity: 2 }]);
    const calls = api({
      extra: (call) => {
        if (call.path !== '/cart/preview') return undefined;
        const [item] = (call.body as { items: { quantity: number }[] }).items;
        return {
          body: {
            data: previewOf([line({ quantity: item!.quantity, lineCents: 400 * item!.quantity })]),
          },
        };
      },
    });
    renderRoute('/cart');

    const items = await screen.findByRole('list', { name: 'Items' });
    const row = within(items).getByRole('listitem', { name: 'Marigold Stickers' });
    expect(row).toHaveTextContent('Single, $4.00 each');
    expect(row).toHaveTextContent('$8.00');
    expect(calls.find((c) => c.path === '/cart/preview')?.body).toEqual({
      items: [{ variantId: 11, quantity: 2 }],
    });

    await user.selectOptions(within(row).getByLabelText('Quantity of Marigold Stickers'), '3');
    await waitFor(() => expect(storedCart()).toEqual([{ variantId: 11, quantity: 3 }]));
    expect(await screen.findByText('$12.00', { selector: 'p span' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/Your cart is empty/)).toBeInTheDocument();
    expect(storedCart()).toEqual([]);
  });

  it('drops items that are gone, with a note, and says what is short', async () => {
    storeCart([
      { variantId: 11, quantity: 9 },
      { variantId: 99, quantity: 1 },
    ]);
    api({
      extra: (call) =>
        call.path === '/cart/preview'
          ? {
              body: {
                data: previewOf(
                  [line({ quantity: 9, available: 5, ok: false, lineCents: 3600 })],
                  [99],
                ),
              },
            }
          : undefined,
    });
    renderRoute('/cart');

    expect(await screen.findByText(/no longer available and was removed/)).toBeInTheDocument();
    await waitFor(() => expect(storedCart()).toEqual([{ variantId: 11, quantity: 9 }]));
    expect(screen.getByRole('alert')).toHaveTextContent('Only 5 left');
    expect(screen.getByRole('button', { name: 'Check out' })).toBeDisabled();
  });

  it('asks a visitor to log in to check out, and comes back here', async () => {
    storeCart([{ variantId: 11, quantity: 1 }]);
    api({
      user: null,
      extra: (call) =>
        call.path === '/cart/preview'
          ? { body: { data: previewOf([line({ quantity: 1, lineCents: 400 })]) } }
          : undefined,
    });
    renderRoute('/cart');
    expect(await screen.findByRole('link', { name: 'Log in to check out' })).toHaveAttribute(
      'href',
      '/login?next=/cart',
    );
  });

  it('checks out and goes to Stripe', async () => {
    const user = userEvent.setup();
    storeCart([{ variantId: 11, quantity: 2 }]);
    const calls = api({
      extra: (call) => {
        if (call.path === '/cart/preview') return { body: { data: previewOf([line()]) } };
        if (call.path === '/orders' && call.method === 'POST') {
          return {
            status: 201,
            body: { data: { orderId: 42, url: 'https://checkout.stripe.com/c/pay/cs_1' } },
          };
        }
        return undefined;
      },
    });
    renderRoute('/cart');

    await user.click(await screen.findByRole('button', { name: 'Check out' }));

    await waitFor(() =>
      expect(goTo).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1'),
    );
    expect(calls.find((c) => c.path === '/orders')?.body).toEqual({
      items: [{ variantId: 11, quantity: 2 }],
    });
  });

  it('says when something sold out at checkout, and refreshes the prices', async () => {
    const user = userEvent.setup();
    storeCart([{ variantId: 11, quantity: 2 }]);
    const calls = api({
      extra: (call) => {
        if (call.path === '/cart/preview') return { body: { data: previewOf([line()]) } };
        if (call.path === '/orders') {
          return {
            status: 409,
            body: {
              error: {
                code: 'OUT_OF_STOCK',
                message: 'Some items in your cart are no longer available in that quantity',
                details: { items: [{ variantId: 11, available: 1 }] },
              },
            },
          };
        }
        return undefined;
      },
    });
    renderRoute('/cart');

    await user.click(await screen.findByRole('button', { name: 'Check out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(goTo).not.toHaveBeenCalled();
    await waitFor(() => expect(calls.filter((c) => c.path === '/cart/preview')).toHaveLength(2));
  });

  it('says so when checkout was cancelled on Stripe', async () => {
    storeCart([{ variantId: 11, quantity: 1 }]);
    api({
      extra: (call) =>
        call.path === '/cart/preview' ? { body: { data: previewOf([line()]) } } : undefined,
    });
    renderRoute('/cart?checkout=cancelled');
    expect(await screen.findByText(/Checkout was cancelled/)).toBeInTheDocument();
  });
});

describe('an order page', () => {
  it('empties the cart after paying, and waits for the confirmation', async () => {
    storeCart([{ variantId: 11, quantity: 2 }]);
    let asked = 0;
    api({
      extra: (call) => {
        if (call.path !== '/orders/42') return undefined;
        asked += 1;
        return {
          body: {
            data:
              asked === 1
                ? {
                    ...ORDER,
                    status: 'pending_payment',
                    paidAt: null,
                    checkoutUrl: 'https://checkout.stripe.com/x',
                  }
                : ORDER,
          },
        };
      },
    });
    renderRoute('/orders/42?payment=success');

    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();
    expect(storedCart()).toEqual([]);
    expect(
      await screen.findByText('Thank you! Your payment went through.', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Marigold Stickers (Single)');
  });

  it('offers to return to an unpaid payment page', async () => {
    api({
      extra: (call) =>
        call.path === '/orders/42'
          ? {
              body: {
                data: {
                  ...ORDER,
                  status: 'pending_payment',
                  paidAt: null,
                  checkoutUrl: 'https://checkout.stripe.com/x',
                  checkoutExpiresAt: '2026-11-27T12:30:00.000Z',
                },
              },
            }
          : undefined,
    });
    renderRoute('/orders/42');
    expect(await screen.findByRole('link', { name: 'Return to payment' })).toHaveAttribute(
      'href',
      'https://checkout.stripe.com/x',
    );
  });

  it("says when an order can't be found", async () => {
    api({
      extra: (call) =>
        call.path === '/orders/7'
          ? { status: 403, body: { error: { code: 'FORBIDDEN', message: 'No' } } }
          : undefined,
    });
    renderRoute('/orders/7');
    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
  });
});

describe('the account page', () => {
  it('lists the client’s orders once there are some', async () => {
    api({
      extra: (call) => {
        if (call.path === '/orders') return page([ORDER]);
        if (call.path === '/users/me')
          return { body: { data: { ...USER, hasPassword: true, googleLinked: false } } };
        if (call.path === '/users/me/commissions' || call.path === '/commissions') return page([]);
        return undefined;
      },
    });
    renderRoute('/account');
    const section = await screen.findByRole('region', { name: 'Your orders' });
    expect(within(section).getByRole('link', { name: 'Order #42' })).toHaveAttribute(
      'href',
      '/orders/42',
    );
    expect(section).toHaveTextContent('$8.00. Paid');
  });
});

describe('the admin order pages', () => {
  const adminOrder = (overrides: Partial<AdminOrder> = {}): AdminOrder => ({
    ...ORDER,
    client: { id: 7, displayName: 'Ana', email: 'ana@example.com' },
    events: [
      {
        fromStatus: 'pending_payment',
        toStatus: 'paid',
        actorType: 'system',
        reason: 'Paid',
        createdAt: ORDER.paidAt!,
      },
    ],
    refunds: [],
    refundable: true,
    ...overrides,
  });

  it('lists orders by status', async () => {
    const user = userEvent.setup();
    const calls = api({
      user: ADMIN,
      extra: (call) => (call.path === '/admin/orders' ? page([adminOrder()]) : undefined),
    });
    renderRoute('/admin/orders');

    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('#42');
    expect(table).toHaveTextContent('Ana');
    await user.selectOptions(screen.getByLabelText('Status'), 'refunded');
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/admin/orders' && c.params.get('status') === 'refunded'),
      ).toBe(true),
    );
  });

  it('refunds an order in full, restocking by default', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = api({
      user: ADMIN,
      extra: (call) => {
        if (call.path === '/admin/orders/42' && call.method === 'GET')
          return { body: { data: adminOrder() } };
        if (call.path === '/admin/orders/42/refund') {
          return {
            body: {
              data: adminOrder({
                status: 'refunded',
                refundedCents: 800,
                refundable: false,
                refunds: [
                  {
                    id: 1,
                    amountCents: 800,
                    status: 'succeeded',
                    reason: 'Broken',
                    restock: true,
                    restockedAt: ORDER.paidAt,
                    createdAt: ORDER.paidAt!,
                  },
                ],
              }),
            },
          };
        }
        return undefined;
      },
    });
    renderRoute('/admin/orders/42');

    const form = await screen.findByRole('form', { name: 'Refund' });
    await user.type(within(form).getByLabelText(/Reason/), 'Broken');
    expect(
      within(form).getByRole('checkbox', { name: 'Put the items back on sale' }),
    ).toBeChecked();
    await user.click(within(form).getByRole('button', { name: 'Refund $8.00' }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/refund'))?.body).toEqual({
        reason: 'Broken',
        restock: true,
      }),
    );
    expect(await screen.findByText(/items back on sale/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Refund' })).not.toBeInTheDocument();
    confirm.mockRestore();
  });
});

/** The shop (milestone 12a): the public pages, the header link, and the admin's product pages. */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminProduct, Product, ProductSummary } from '@shared/types/shop.ts';
import type { Call, MockResponse } from '../../test/utils.tsx';
import { SIGNED_OUT, USER, mockApi, page, renderRoute } from '../../test/utils.tsx';

const ADMIN = { ...USER, id: 1, role: 'admin' as const };

const photo = (id: number, altText: string | null = `Photo ${id}`) => ({
  id,
  smallUrl: `/media/shop/products/1/${String(id).padStart(16, '0')}-small.webp`,
  largeUrl: `/media/shop/products/1/${String(id).padStart(16, '0')}-large.webp`,
  width: 1600,
  height: 1200,
  altText,
});

const STICKERS: ProductSummary = {
  slug: 'marigold-stickers',
  name: 'Marigold Stickers',
  category: 'stickers',
  priceFromCents: 400,
  priceToCents: 1500,
  available: true,
  oneOfAKind: false,
  photo: photo(1, 'Three marigold stickers'),
};

const VASE: ProductSummary = {
  slug: 'blue-vase',
  name: 'Blue Vase',
  category: 'upcycled',
  priceFromCents: 9000,
  priceToCents: 9000,
  available: false,
  oneOfAKind: true,
  photo: photo(2),
};

const STICKERS_PAGE: Product = {
  ...STICKERS,
  description: 'Glossy vinyl.\n\nWeatherproof.',
  materials: 'Vinyl',
  dimensions: '3 in',
  variants: [
    { id: 11, name: 'Single', priceCents: 400, available: true },
    { id: 12, name: 'Pack of 5', priceCents: 1500, available: false },
  ],
  photos: [photo(1, 'Three marigold stickers'), photo(3, 'The back of a sticker')],
};

function api({
  user = null as typeof USER | typeof ADMIN | null,
  open = true,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return user ? { body: { data: user } } : SIGNED_OUT;
    if (call.path === '/shop') return { body: { data: { open } } };
    if (call.path === '/shop/products') {
      if (!open && user?.role !== 'admin') {
        return { status: 404, body: { error: { code: 'SHOP_CLOSED', message: 'Closed' } } };
      }
      const category = call.params.get('category');
      return page([STICKERS, VASE].filter((p) => !category || p.category === category));
    }
    if (call.path === '/shop/products/marigold-stickers') return { body: { data: STICKERS_PAGE } };
    return undefined;
  });
}

describe('the shop page', () => {
  it('lists products with their price, and marks sold pieces', async () => {
    api();
    renderRoute('/shop');

    const list = await screen.findByRole('list', { name: 'Products' });
    const [stickers, vase] = within(list).getAllByRole('listitem');
    expect(within(stickers!).getByRole('link')).toHaveAttribute('href', '/shop/marigold-stickers');
    expect(stickers).toHaveTextContent('From $4.00');
    expect(within(stickers!).getByRole('img')).toHaveAttribute('alt', 'Three marigold stickers');
    expect(vase).toHaveTextContent('Sold');
    expect(vase).toHaveTextContent('$90.00');
    expect(screen.queryByRole('note')).not.toBeInTheDocument(); // no preview note once open
  });

  it('filters by category through the URL', async () => {
    const user = userEvent.setup();
    const calls = api();
    renderRoute('/shop');

    const nav = await screen.findByRole('navigation', { name: 'Shop categories' });
    await user.click(within(nav).getByRole('link', { name: 'Upcycled thrifted pieces' }));

    await waitFor(() =>
      expect(calls.some((c) => c.params.get('category') === 'upcycled')).toBe(true),
    );
    expect(within(nav).getByRole('link', { name: 'Upcycled thrifted pieces' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const list = await screen.findByRole('list', { name: 'Products' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
  });

  it('is "page not found" for visitors while closed', async () => {
    api({ open: false });
    renderRoute('/shop');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('is a preview for the admin while closed', async () => {
    api({ open: false, user: ADMIN });
    renderRoute('/shop');
    expect(await screen.findByRole('note')).toHaveTextContent('only visible to you');
    expect(await screen.findByRole('list', { name: 'Products' })).toBeInTheDocument();
  });
});

describe('the header', () => {
  it('shows the shop to everyone once open', async () => {
    api();
    renderRoute('/about');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(nav).findByRole('link', { name: 'Shop' })).toBeInTheDocument();
  });

  it('hides it from visitors while closed, but not from the admin', async () => {
    api({ open: false });
    const view = renderRoute('/about');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    await screen.findByRole('link', { name: 'Log in' });
    expect(within(nav).queryByRole('link', { name: 'Shop' })).not.toBeInTheDocument();
    view.unmount();

    api({ open: false, user: ADMIN });
    renderRoute('/about');
    const adminNav = await screen.findByRole('navigation', { name: 'Main' });
    expect(await within(adminNav).findByRole('link', { name: 'Shop' })).toBeInTheDocument();
  });
});

describe('a product page', () => {
  it('shows the photos, options with their prices, and the details', async () => {
    const user = userEvent.setup();
    api();
    renderRoute('/shop/marigold-stickers');

    expect(await screen.findByRole('heading', { name: 'Marigold Stickers' })).toBeInTheDocument();
    const options = screen.getByRole('group', { name: 'Options' });
    expect(within(options).getByRole('radio', { name: /Single: \$4\.00/ })).toBeChecked();
    expect(within(options).getByText(/Pack of 5: \$15\.00 \(sold out\)/)).toBeInTheDocument();
    expect(screen.getByText('Glossy vinyl.')).toBeInTheDocument();
    expect(screen.getByText('Weatherproof.')).toBeInTheDocument();
    expect(screen.getByText('Vinyl')).toBeInTheDocument();

    // The main photo changes with the thumbnails.
    expect(screen.getByRole('img', { name: 'Three marigold stickers' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Photo 2 of 2' }));
    expect(screen.getByRole('img', { name: 'The back of a sticker' })).toBeInTheDocument();

    // Choosing the sold-out pack shows its price and that it's sold out.
    await user.click(within(options).getByRole('radio', { name: /Pack of 5/ }));
    expect(screen.getByText('$15.00')).toBeInTheDocument();
  });

  it('is "page not found" for an unknown product', async () => {
    api();
    renderRoute('/shop/nothing-here');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

// --- Admin ---

const draft = (overrides: Partial<AdminProduct> = {}): AdminProduct => ({
  id: 5,
  slug: 'marigold-earrings',
  name: 'Marigold Earrings',
  category: 'jewelry',
  priceFromCents: 0,
  priceToCents: 0,
  available: false,
  oneOfAKind: false,
  photo: null,
  description: '',
  materials: null,
  dimensions: null,
  photos: [],
  variants: [],
  published: false,
  stock: 0,
  missing: ['variant', 'photo'],
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  ...overrides,
});

function adminApi(extra: (call: Call) => MockResponse | undefined, product = draft()) {
  let current = product;
  const calls = api({
    user: ADMIN,
    open: false,
    extra: (call) => {
      const answer = extra(call);
      if (answer) {
        const body = answer.body as { data?: AdminProduct } | undefined;
        if (body?.data && 'missing' in body.data) current = body.data;
        return answer;
      }
      if (call.path === '/admin/shop/products' && call.method === 'GET') return page([current]);
      if (call.path === `/admin/shop/products/${current.id}` && call.method === 'GET') {
        return { body: { data: current } };
      }
      return undefined;
    },
  });
  return calls;
}

describe('the admin shop pages', () => {
  it('lists products with their state, and creates a draft', async () => {
    const user = userEvent.setup();
    const calls = adminApi((call) =>
      call.path === '/admin/shop/products' && call.method === 'POST'
        ? { status: 201, body: { data: draft() } }
        : undefined,
    );
    renderRoute('/admin/shop');

    const table = await screen.findByRole('table');
    expect(table).toHaveTextContent('Draft (needs an option, a photo)');
    expect(table).toHaveTextContent('Handmade beaded jewelry');

    const form = screen.getByRole('form', { name: 'New product' });
    await user.type(within(form).getByLabelText('Name'), 'Marigold Earrings');
    await user.selectOptions(within(form).getByLabelText('Category'), 'jewelry');
    await user.click(within(form).getByRole('button', { name: 'Create product' }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        name: 'Marigold Earrings',
        category: 'jewelry',
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Marigold Earrings' })).toBeInTheDocument();
  });

  it('adds an option with its price in cents, and can only publish once complete', async () => {
    const user = userEvent.setup();
    const withOption = draft({
      variants: [{ id: 9, name: 'Pair', priceCents: 2450, available: true, stock: 3 }],
      stock: 3,
      missing: ['photo'],
    });
    const calls = adminApi((call) =>
      call.path === '/admin/shop/products/5/variants'
        ? { status: 201, body: { data: withOption } }
        : undefined,
    );
    renderRoute('/admin/shop/5');

    expect(await screen.findByRole('button', { name: 'Publish' })).toBeDisabled();
    const form = screen.getByRole('form', { name: 'Add an option' });
    await user.type(within(form).getByLabelText('Option name', { exact: false }), 'Pair');
    await user.type(within(form).getByLabelText('Price ($)'), '24.50');
    await user.type(within(form).getByLabelText('Stock'), '3');
    await user.click(within(form).getByRole('button', { name: 'Add option' }));

    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/variants'))?.body).toEqual({
        name: 'Pair',
        priceCents: 2450,
        stock: 3,
      }),
    );
    expect(await screen.findByRole('listitem', { name: 'Option Pair' })).toBeInTheDocument();
    expect(screen.getByText('Draft (needs a photo)')).toBeInTheDocument();
  });

  it('refuses a price that is not an amount', async () => {
    const user = userEvent.setup();
    const calls = adminApi(() => undefined);
    renderRoute('/admin/shop/5');

    const form = await screen.findByRole('form', { name: 'Add an option' });
    await user.type(within(form).getByLabelText('Option name', { exact: false }), 'Pair');
    await user.type(within(form).getByLabelText('Price ($)'), 'free');
    await user.click(within(form).getByRole('button', { name: 'Add option' }));

    expect(await within(form).findByText('Enter a price, like 4.50')).toBeInTheDocument();
    expect(calls.some((c) => c.path.endsWith('/variants'))).toBe(false);
  });

  it('sets stock with a reason, and uploads a photo', async () => {
    const user = userEvent.setup();
    const product = draft({
      variants: [{ id: 9, name: 'Pair', priceCents: 2450, available: true, stock: 3 }],
      stock: 3,
      missing: ['photo'],
    });
    const calls = adminApi((call) => {
      if (call.path === '/admin/shop/variants/9/stock') {
        return { body: { data: { ...product, stock: 8 } } };
      }
      if (call.path === '/admin/shop/products/5/photos') {
        return {
          status: 201,
          body: { data: { ...product, photos: [photo(4, null)], missing: ['alt_text'] } },
        };
      }
      return undefined;
    }, product);
    renderRoute('/admin/shop/5');

    const stock = await screen.findByRole('form', { name: 'Stock' });
    const count = within(stock).getByLabelText('Stock (now 3)');
    await user.clear(count);
    await user.type(count, '8');
    await user.selectOptions(within(stock).getByLabelText('Why'), 'adjustment');
    await user.type(within(stock).getByLabelText('Note (optional)'), 'Recount');
    await user.click(within(stock).getByRole('button', { name: 'Set stock' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/stock'))?.body).toEqual({
        stock: 8,
        reason: 'adjustment',
        note: 'Recount',
      }),
    );

    const file = new File(['jpeg bytes'], 'earrings.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText(/Add a photo/), file);
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/photos'))?.body).toBe(file));
    expect(await screen.findByRole('listitem', { name: 'Photo 1' })).toBeInTheDocument();
    expect(screen.getByText('Draft (needs alt text)')).toBeInTheDocument();
  });

  it('deletes a product after confirming', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = adminApi((call) => (call.method === 'DELETE' ? { status: 204 } : undefined));
    renderRoute('/admin/shop/5');

    await user.click(await screen.findByRole('button', { name: 'Delete product' }));

    expect(confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/admin/shop/products/5')).toBe(
        true,
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Shop products' })).toBeInTheDocument();
    confirm.mockRestore();
  });
});

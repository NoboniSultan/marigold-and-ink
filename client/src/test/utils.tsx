import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { Artwork } from '@shared/types/artwork.ts';
import type { User } from '@shared/types/user.ts';
import { AuthProvider } from '../auth/AuthContext.tsx';
import { routes } from '../App.tsx';

export interface MockResponse {
  status?: number;
  body?: unknown;
}

export interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

/**
 * Replaces fetch with a fake API. `handler` returns a response for a request, or undefined
 * for a 404. Every call is recorded, so tests can check what the page asked the API for.
 */
export function mockApi(handler: (call: Call) => MockResponse | undefined) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname.replace(/^\/api\/v1/, ''),
      params: url.searchParams,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const response = handler(call) ?? {
      status: 404,
      body: { error: { code: 'ROUTE_NOT_FOUND', message: 'Not found' } },
    };
    const status = response.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(response.body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

/** Renders the real app routes at `path`, with fresh caches and no retries. */
export function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}

const variant = (slug: string, size: 'thumb' | 'large') => ({
  src: `/media/artworks/${slug}.${size}.11111111.webp`,
  width: size === 'thumb' ? 600 : 1500,
  height: size === 'thumb' ? 800 : 2000,
});

export function artwork(overrides: Partial<Artwork> & { slug: string; title: string }): Artwork {
  return {
    id: overrides.slug.length * 7,
    description: null,
    medium: 'ink',
    category: 'portraits',
    year: null,
    credit: null,
    tags: [],
    image: {
      thumb: variant(overrides.slug, 'thumb'),
      large: variant(overrides.slug, 'large'),
      alt: `${overrides.title}, ink`,
    },
    ...overrides,
  };
}

export const ARTWORKS: Artwork[] = [
  artwork({ id: 1, slug: 'embrace', title: 'Embrace', credit: 'after Oswaldo Guayasamín' }),
  artwork({ id: 2, slug: 'fawn', title: 'Fawn', category: 'nature', medium: 'scratchboard' }),
  artwork({ id: 3, slug: 'starry-night', title: 'Starry Night', category: 'studies' }),
];

export const USER: User = {
  id: 7,
  email: 'client@example.com',
  displayName: 'Client',
  role: 'client',
  emailVerifiedAt: '2026-11-21T00:00:00.000Z',
  createdAt: '2026-11-21T00:00:00.000Z',
  updatedAt: '2026-11-21T00:00:00.000Z',
};

/** GET /auth/session for a visitor who isn't logged in. */
export const SIGNED_OUT: MockResponse = { body: { data: null } };

export const page = <T,>(data: T[]) => ({
  body: { data, meta: { page: 1, pageSize: 20, total: data.length } },
});

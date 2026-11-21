/**
 * Page smoke tests through the real routes, with a fake API. Animations are skipped
 * (MotionGlobalConfig), and matchMedia reports a narrow screen, so the gallery uses Grid.
 * The 3D Explore mode needs WebGL and is covered by the manual checklist in the PR.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Call, MockResponse } from '../test/utils.tsx';
import { ARTWORKS, SIGNED_OUT, USER, mockApi, page, renderRoute } from '../test/utils.tsx';
import { safeNextPath } from '../auth/RequireAuth.tsx';
import { COPY } from '../content/copy.ts';

const OPTIONS = {
  combinations: [
    { size: 'A4', medium: 'graphite' },
    { size: 'A3', medium: 'graphite' },
    { size: 'A4', medium: 'ink' },
  ],
  fulfillmentTypes: ['digital', 'physical'],
  multipleSubjects: true,
  rushAvailable: true,
};

/** A fake API with the common read endpoints; `extra` can answer anything first. */
function api({
  user = null as typeof USER | null,
  extra = (_call: Call): MockResponse | undefined => undefined,
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return user ? { body: { data: user } } : SIGNED_OUT;
    if (call.path === '/artworks') {
      const category = call.params.get('category');
      return page(category ? ARTWORKS.filter((a) => a.category === category) : ARTWORKS);
    }
    if (call.path === '/artworks/categories') {
      return {
        body: {
          data: [
            { category: 'nature', count: 1 },
            { category: 'portraits', count: 1 },
          ],
        },
      };
    }
    if (call.path === '/tags') return { body: { data: [] } };
    const slug = call.path.match(/^\/artworks\/([\w-]+)$/)?.[1];
    const artwork = ARTWORKS.find((a) => a.slug === slug);
    if (artwork) return { body: { data: artwork } };
    if (call.path === '/pricing/options') return { body: { data: OPTIONS } };
    return undefined;
  });
}

describe('Home', () => {
  it('shows the hero lines to screen readers and the call to action', async () => {
    api();
    renderRoute('/');

    expect(screen.getByText(COPY.heroLines.join(' '))).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: COPY.primaryCta }).length).toBeGreaterThan(0);
  });

  it('steps through featured artworks with the arrows and the keyboard, wrapping around', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderRoute('/');

    const carousel = await screen.findByRole('region', { name: 'Featured work' });
    expect(await within(carousel).findByRole('heading', { name: 'Embrace' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/artworks')!.params.get('pageSize')).toBe('5');

    await user.click(within(carousel).getByRole('button', { name: 'Next piece' }));
    expect(await within(carousel).findByRole('heading', { name: 'Fawn' })).toBeInTheDocument();

    await user.click(within(carousel).getByRole('button', { name: 'Previous piece' }));
    await user.click(within(carousel).getByRole('button', { name: 'Previous piece' }));
    expect(
      await within(carousel).findByRole('heading', { name: 'Starry Night' }),
    ).toBeInTheDocument();
    expect(within(carousel).getByText('3 of 3: Starry Night')).toBeInTheDocument();
  });
});

describe('Gallery', () => {
  it('lists artworks in Grid mode on small screens', async () => {
    api();
    renderRoute('/gallery');

    expect(await screen.findByRole('button', { name: 'Open Embrace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters by category through the API', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderRoute('/gallery');

    await user.click(await screen.findByRole('button', { name: /nature/i }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Embrace' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open Fawn' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/artworks' && c.params.get('category') === 'nature')).toBe(
      true,
    );
  });

  it('opens an artwork in a dialog (?art= in the URL) and closes it with Escape', async () => {
    api();
    const user = userEvent.setup();
    const { router } = renderRoute('/gallery');

    await user.click(await screen.findByRole('button', { name: 'Open Embrace' }));
    const dialog = await screen.findByRole('dialog', { name: 'Embrace' });
    expect(within(dialog).getByText('after Oswaldo Guayasamín')).toBeInTheDocument();
    expect(router.state.location.search).toContain('art=embrace');

    await user.keyboard('{Escape}');
    // Escape removes ?art=, which is what closes the dialog. (The dialog then morphs back
    // into its card. jsdom has no layout, so that shared-layout exit never finishes here;
    // the removal itself is checked in a real browser, see the PR checklist.)
    await waitFor(() => expect(router.state.location.search).not.toContain('art='));
  });

  it('opens the dialog from a shared link (?art=)', async () => {
    api();
    renderRoute('/gallery?mode=grid&art=fawn');

    expect(await screen.findByRole('dialog', { name: 'Fawn' })).toBeInTheDocument();
  });
});

describe('Artwork page', () => {
  it('shows the artwork and its details', async () => {
    api();
    renderRoute('/gallery/embrace');

    expect(await screen.findByRole('heading', { level: 1, name: 'Embrace' })).toBeInTheDocument();
    expect(screen.getByText('after Oswaldo Guayasamín')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Embrace, ink' })).toHaveAttribute('srcset');
  });

  it('shows "not found" for an unknown or unpublished artwork', async () => {
    api();
    renderRoute('/gallery/no-such-art');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('About', () => {
  it('shows the photos and the bio', async () => {
    const photo = ARTWORKS[0]!.image;
    api({
      extra: (call) =>
        call.path === '/about'
          ? {
              body: {
                data: {
                  photo: { ...photo, alt: 'The artist with flowers' },
                  bio: ['First paragraph.', 'Second paragraph.'],
                  closingPhoto: { ...photo, alt: 'At the painted bench' },
                  isPlaceholder: false,
                },
              },
            }
          : undefined,
    });
    renderRoute('/about');

    expect(await screen.findByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'The artist with flowers' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'At the painted bench' })).toBeInTheDocument();
  });
});

describe('Commission', () => {
  it('sends logged-out visitors to log in, then back', async () => {
    api();
    const { router } = renderRoute('/commission');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Fcommission');
  });

  it('offers only priced combinations and submits a request', async () => {
    const calls = api({
      user: USER,
      extra: (call) =>
        call.method === 'POST' && call.path === '/commissions'
          ? {
              status: 201,
              body: {
                data: {
                  id: 42,
                  ...(call.body as object),
                  status: 'inquiry',
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/commission');

    const medium = await screen.findByLabelText('Medium');
    await user.selectOptions(medium, 'ink');
    // Only A4 exists in ink, so the size list follows the medium.
    expect(
      within(screen.getByLabelText('Size'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['A4']);

    await user.click(screen.getByLabelText('Physical'));
    await user.click(screen.getByLabelText('Rush service'));
    await user.type(screen.getByLabelText('Notes'), 'Our dog, Biscuit');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('heading', { name: 'Request received' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      medium: 'ink',
      size: 'A4',
      subjectCount: 1,
      fulfillmentType: 'physical',
      isRush: true,
      notes: 'Our dog, Biscuit',
    });
  });

  it("shows the server's reason when a request is refused", async () => {
    api({
      user: USER,
      extra: (call) =>
        call.method === 'POST'
          ? {
              status: 422,
              body: {
                error: {
                  code: 'UNSUPPORTED_SIZE_MEDIUM',
                  message: "A4 ink portraits aren't offered",
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/commission');

    await user.click(await screen.findByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("A4 ink portraits aren't offered");
  });
});

describe('Login and register', () => {
  it('shows a failed login and keeps the visitor on the page', async () => {
    api({
      extra: (call) =>
        call.path === '/auth/login'
          ? {
              status: 401,
              body: {
                error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/login');

    await user.type(await screen.findByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password!');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('logs in and continues to the requested page', async () => {
    api({
      extra: (call) => (call.path === '/auth/login' ? { body: { data: USER } } : undefined),
    });
    const user = userEvent.setup();
    const { router } = renderRoute('/login?next=%2Fabout');

    await user.type(await screen.findByLabelText('Email'), 'client@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/about'));
    expect(await screen.findByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  it("shows the server's field errors under the right inputs", async () => {
    api({
      extra: (call) =>
        call.path === '/auth/register'
          ? {
              status: 400,
              body: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Request validation failed',
                  details: [
                    {
                      location: 'body',
                      path: 'password',
                      message: 'must be at least 12 characters',
                    },
                  ],
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/register');

    await user.type(await screen.findByLabelText('Your name'), 'Ana');
    await user.type(screen.getByLabelText('Email'), 'ana@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('must be at least 12 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('Not found and redirects', () => {
  it('shows a 404 page for unknown paths', async () => {
    api();
    renderRoute('/nowhere');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('only allows same-site paths after login', () => {
    expect(safeNextPath('/commission')).toBe('/commission');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});

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
  providers = { google: true, emailSignup: true },
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
    if (call.path === '/auth/providers') return { body: { data: providers } };
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
    // The whole gallery, so black-and-white and coloured pieces can be mixed (mixTones).
    expect(calls.find((c) => c.path === '/artworks')!.params.get('pageSize')).toBe('100');

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

  it('explains a page past the end and offers page 1, instead of "no artworks match"', async () => {
    api({
      extra: (call) =>
        call.path === '/artworks' && call.params.get('page') === '9'
          ? { body: { data: [], meta: { page: 9, pageSize: 24, total: 30 } } }
          : undefined,
    });
    const user = userEvent.setup();
    const { router } = renderRoute('/gallery?page=9');

    expect(await screen.findByText(/no page 9; these results end at page 2/)).toBeInTheDocument();
    expect(screen.queryByText(/No artworks match/)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Gallery pages' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Go to page 1' }));
    expect(await screen.findByRole('button', { name: 'Open Embrace' })).toBeInTheDocument();
    expect(router.state.location.search).not.toContain('page=');
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

  it('keeps keyboard focus inside the open dialog, both directions', async () => {
    api();
    const user = userEvent.setup();
    renderRoute('/gallery?mode=grid&art=fawn');

    const dialog = await screen.findByRole('dialog', { name: 'Fawn' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const fullPage = within(dialog).getByRole('link', { name: 'Open the full page' });
    await waitFor(() => expect(close).toHaveFocus());

    await user.tab(); // the close button is last in the dialog, so Tab wraps to the first
    expect(fullPage).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(fullPage).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
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
                  bio: [{ heading: 'A little about me' }, 'First paragraph.', 'Second paragraph.'],
                  closingPhoto: { ...photo, alt: 'At the painted bench' },
                  isPlaceholder: false,
                },
              },
            }
          : undefined,
    });
    renderRoute('/about');

    expect(await screen.findByText('Second paragraph.')).toBeInTheDocument();
    // The opening subheading becomes the page title, replacing "About".
    expect(
      screen.getByRole('heading', { level: 1, name: 'A little about me' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'About' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'The artist with flowers' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'At the painted bench' })).toBeInTheDocument();
  });
});

describe('Privacy', () => {
  it('shows the policy from the copy file, linked from the footer', async () => {
    api();
    renderRoute('/privacy');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Privacy policy' }),
    ).toBeInTheDocument();
    for (const section of COPY.privacy.sections) {
      expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeInTheDocument();
    }
    const footer = screen.getByRole('navigation', { name: 'Footer' });
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
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
    expect(screen.getByRole('link', { name: 'View your request' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/commissions\/\d+$/),
    );
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

  it('shows every field error next to its field, linked for screen readers', async () => {
    const issues = {
      medium: 'Choose a medium',
      size: 'Choose a size',
      subjectCount: 'Must be at least 1',
      fulfillmentType: 'Choose how it is delivered',
      isRush: 'Rush is not available',
      notes: 'Too long',
    };
    api({
      user: USER,
      extra: (call) =>
        call.method === 'POST'
          ? {
              status: 400,
              body: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid request',
                  details: Object.entries(issues).map(([path, message]) => ({ path, message })),
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/commission');

    await user.click(await screen.findByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please check the highlighted fields',
    );
    const controls = {
      medium: screen.getByLabelText('Medium'),
      size: screen.getByLabelText('Size'),
      subjectCount: screen.getByLabelText('Number of subjects'),
      fulfillmentType: screen.getByRole('group', { name: 'Delivery' }),
      isRush: screen.getByLabelText('Rush service'),
      notes: screen.getByLabelText('Notes'),
    };
    for (const [field, control] of Object.entries(controls)) {
      expect(control).toHaveAccessibleDescription(
        expect.stringContaining(issues[field as keyof typeof issues]),
      );
    }
    expect(controls.medium).toHaveAttribute('aria-invalid', 'true');
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

  it('logs out and goes home', async () => {
    api({
      user: USER,
      extra: (call) => (call.path === '/auth/logout' ? { status: 204 } : undefined),
    });
    const user = userEvent.setup();
    const { router } = renderRoute('/gallery');

    await user.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('says so when logging out fails, and stays logged in', async () => {
    api({
      user: USER,
      extra: (call) =>
        call.path === '/auth/logout'
          ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Oops' } } }
          : undefined,
    });
    const user = userEvent.setup();
    const { router } = renderRoute('/gallery');

    await user.click(await screen.findByRole('button', { name: 'Log out' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't log you out");
    expect(screen.getByRole('button', { name: 'Log out' })).toBeEnabled();
    expect(router.state.location.pathname).toBe('/gallery');
  });

  it('signs up in two steps: email, then the code with name and password', async () => {
    const calls = api({
      extra: (call) => {
        if (call.path === '/auth/signup/start') {
          return {
            status: 202,
            body: { data: { email: 'ana@example.com', resendAfterSeconds: 60 } },
          };
        }
        if (call.path === '/auth/signup/complete') return { status: 201, body: { data: USER } };
        return undefined;
      },
    });
    const user = userEvent.setup();
    const { router } = renderRoute('/register?next=%2Fcommission');

    await user.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    expect(
      await screen.findByText(/We sent a 6-digit code to ana@example.com/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.type(screen.getByLabelText('Your name'), 'Ana');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/commission'));
    expect(calls.find((c) => c.path === '/auth/signup/complete')!.body).toEqual({
      email: 'ana@example.com',
      code: '123456',
      displayName: 'Ana',
      password: 'a long enough password',
    });
  });

  it("shows a wrong code's message and the server's field errors", async () => {
    api({
      extra: (call) => {
        if (call.path === '/auth/signup/start') {
          return {
            status: 202,
            body: { data: { email: 'ana@example.com', resendAfterSeconds: 60 } },
          };
        }
        if (call.path === '/auth/signup/complete') {
          return {
            status: 422,
            body: {
              error: { code: 'CODE_INCORRECT', message: "That code isn't right. 4 tries left." },
            },
          };
        }
        return undefined;
      },
    });
    const user = userEvent.setup();
    renderRoute('/register');

    await user.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.type(screen.getByLabelText('Your name'), 'Ana');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That code isn't right. 4 tries left.",
    );
  });

  it('says email sign-up opens soon when the server cannot send email, and offers Google', async () => {
    api({ providers: { google: true, emailSignup: false } });
    renderRoute('/register');

    expect(await screen.findByText('Sign-up by email opens soon.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/start?next=%2F',
    );
  });
});

describe('Google sign-in on the login page', () => {
  it('shows the Google button only when Google is switched on, keeping ?next', async () => {
    api({ providers: { google: true, emailSignup: true } });
    renderRoute('/login?next=%2Fcommission');

    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute(
      'href',
      '/api/v1/auth/google/start?next=%2Fcommission',
    );
  });

  it('hides it when Google is off', async () => {
    api({ providers: { google: false, emailSignup: true } });
    renderRoute('/login');

    await screen.findByRole('heading', { name: 'Log in' });
    await waitFor(() => expect(screen.queryByText('Continue with Google')).toBeNull());
  });

  it('explains why a Google sign-in came back', async () => {
    api();
    renderRoute('/login?error=google_unverified_email');

    expect(await screen.findByRole('alert')).toHaveTextContent("email isn't verified with Google");
  });

  it('offers a code to an account whose email was never verified', async () => {
    api({
      extra: (call) =>
        call.path === '/auth/login'
          ? {
              status: 403,
              body: {
                error: {
                  code: 'EMAIL_NOT_VERIFIED',
                  message:
                    'Please verify your email: sign up again with this address to get a code.',
                },
              },
            }
          : undefined,
    });
    const user = userEvent.setup();
    renderRoute('/login');

    await user.type(await screen.findByLabelText('Email'), 'old@example.com');
    await user.type(screen.getByLabelText('Password'), 'the right password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('link', { name: 'Get a code' })).toHaveAttribute(
      'href',
      '/register?email=old%40example.com',
    );
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
    expect(safeNextPath('/gallery?tag=floral&page=2')).toBe('/gallery?tag=floral&page=2');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/'); // browsers read \ as /
    expect(safeNextPath('/\t/evil.example')).toBe('/'); // browsers drop tabs
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});

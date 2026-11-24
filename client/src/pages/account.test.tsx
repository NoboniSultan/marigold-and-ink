/** The account page (/account): details, commissions, password, and deletion. */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Commission } from '@shared/types/commission.ts';
import type { Account } from '@shared/types/user.ts';
import type { Call, MockResponse } from '../test/utils.tsx';
import { SIGNED_OUT, USER, mockApi, page, renderRoute } from '../test/utils.tsx';

const ACCOUNT: Account = { ...USER, hasPassword: true, hasGoogle: false };

const COMMISSION: Commission = {
  id: 12,
  clientId: USER.id,
  size: 'A3',
  medium: 'ink',
  subjectCount: 1,
  fulfillmentType: 'digital',
  isRush: false,
  notes: null,
  status: 'quoted',
  revisionCount: 0,
  revisionLimit: 2,
  quotedTotalCents: 11000,
  depositCents: 5500,
  balanceCents: 5500,
  createdAt: '2026-11-22T00:00:00.000Z',
  updatedAt: '2026-11-22T00:00:00.000Z',
};

function api({
  account = ACCOUNT,
  commissions = [COMMISSION],
  extra = (_call: Call): MockResponse | undefined => undefined,
}: {
  account?: Account | null;
  commissions?: Commission[];
  extra?: (call: Call) => MockResponse | undefined;
} = {}) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return account ? { body: { data: USER } } : SIGNED_OUT;
    if (call.path === '/users/me' && call.method === 'GET') return { body: { data: account } };
    if (call.path === '/commissions') return page(commissions);
    if (call.path === '/auth/providers') {
      return { body: { data: { google: true, emailSignup: true } } };
    }
    return undefined;
  });
}

describe('Account page', () => {
  it('sends logged-out visitors to log in, then back', async () => {
    api({ account: null });
    const { router } = renderRoute('/account');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('?next=%2Faccount');
  });

  it('shows the details, sign-in method, and commissions, linked from the header', async () => {
    api();
    renderRoute('/account');

    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeInTheDocument();
    expect(screen.getByText('client@example.com')).toBeInTheDocument();
    expect(screen.getByText('email and password')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Request #12' })).toHaveAttribute(
      'href',
      '/commissions/12',
    );
    expect(await screen.findByText(/Quoted\. The deposit starts the work\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
  });

  it('offers a link to request one when there are no commissions yet', async () => {
    api({ commissions: [] });
    renderRoute('/account');

    expect(await screen.findByRole('link', { name: 'Request one' })).toHaveAttribute(
      'href',
      '/commission',
    );
  });

  it('saves a new name', async () => {
    const calls = api({
      extra: (call) =>
        call.method === 'PATCH'
          ? { body: { data: { ...ACCOUNT, displayName: 'Noor' } } }
          : undefined,
    });
    renderRoute('/account');
    const name = await screen.findByLabelText('Name');

    await userEvent.clear(name);
    await userEvent.type(name, 'Noor');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Your name is saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ displayName: 'Noor' });
  });

  it('shows a field error when the name is rejected', async () => {
    api({
      extra: (call) =>
        call.method === 'PATCH'
          ? {
              status: 400,
              body: {
                error: {
                  code: 'VALIDATION_ERROR',
                  message: 'Invalid request',
                  details: [{ location: 'body', path: 'displayName', message: 'Too short' }],
                },
              },
            }
          : undefined,
    });
    renderRoute('/account');
    await userEvent.clear(await screen.findByLabelText('Name'));
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Too short')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please check the highlighted fields.');
  });

  it('changes the password', async () => {
    const calls = api({
      extra: (call) => (call.path === '/users/me/password' ? { status: 204 } : undefined),
    });
    renderRoute('/account');

    await userEvent.type(await screen.findByLabelText('Current password'), 'old passphrase');
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/Your password is changed/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/users/me/password')?.body).toEqual({
      currentPassword: 'old passphrase',
      newPassword: 'a brand new passphrase',
    });
  });

  it('says so when the current password is wrong', async () => {
    api({
      extra: (call) =>
        call.path === '/users/me/password'
          ? {
              status: 403,
              body: {
                error: { code: 'PASSWORD_INCORRECT', message: 'That password is not correct' },
              },
            }
          : undefined,
    });
    renderRoute('/account');

    await userEvent.type(await screen.findByLabelText('Current password'), 'wrong');
    await userEvent.type(screen.getByLabelText('New password'), 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not correct');
  });

  it('explains there is no password for a Google-only account, and confirms deletion by email', async () => {
    const calls = api({
      account: { ...ACCOUNT, hasPassword: false, hasGoogle: true },
      extra: (call) => (call.method === 'DELETE' ? { status: 204 } : undefined),
    });
    const { router } = renderRoute('/account');

    expect(await screen.findByText(/You sign in with Google/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('Type your email address to confirm'),
      'client@example.com',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({
      confirmEmail: 'client@example.com',
    });
  });

  it('deletes the account with the password, then signs out and goes home', async () => {
    let deleted = false;
    const calls = api({
      extra: (call) => {
        if (call.method === 'DELETE') {
          deleted = true;
          return { status: 204 };
        }
        if (call.path === '/auth/session' && deleted) return SIGNED_OUT;
        return undefined;
      },
    });
    const { router } = renderRoute('/account');
    const button = await screen.findByRole('button', { name: 'Delete my account' });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Your password'), 'my passphrase');
    await userEvent.click(button);

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ password: 'my passphrase' });
    expect(await screen.findByRole('link', { name: 'Log in' })).toBeInTheDocument();
  });

  it('links the commissions that block deletion', async () => {
    api({
      extra: (call) =>
        call.method === 'DELETE'
          ? {
              status: 422,
              body: {
                error: {
                  code: 'ACTIVE_COMMISSIONS',
                  message: 'This account has a commission in progress.',
                  details: { commissionIds: [12] },
                },
              },
            }
          : undefined,
    });
    renderRoute('/account');

    await userEvent.type(await screen.findByLabelText('Your password'), 'my passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This account has a commission in progress.');
    expect(screen.getAllByRole('link', { name: 'Request #12' })).toHaveLength(2);
  });

  it('hides account deletion from the admin', async () => {
    api({ account: { ...ACCOUNT, role: 'admin' } });
    renderRoute('/account');

    expect(await screen.findByRole('heading', { name: 'Password' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delete your account' })).not.toBeInTheDocument();
  });

  it('offers a retry when the account fails to load', async () => {
    api({
      extra: (call) =>
        call.path === '/users/me'
          ? { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } }
          : undefined,
    });
    renderRoute('/account');

    expect(await screen.findByText("Your account couldn't load.")).toBeInTheDocument();
  });
});

describe('Account page: email change and data download', () => {
  it('changes the email in two steps, then shows the new address', async () => {
    const user = userEvent.setup();
    const calls = api({
      extra: (call) => {
        if (call.path === '/users/me/email') {
          return {
            status: 202,
            body: { data: { email: 'moved@example.com', resendAfterSeconds: 60 } },
          };
        }
        if (call.path === '/users/me/email/confirm') {
          return { body: { data: { ...ACCOUNT, email: 'moved@example.com' } } };
        }
        return undefined;
      },
    });
    renderRoute('/account');

    await user.type(await screen.findByLabelText('New email address'), 'moved@example.com');
    await user.type(screen.getByLabelText("Password, to confirm it's you"), 'my passphrase');
    await user.click(screen.getByRole('button', { name: 'Email a code to the new address' }));

    expect(
      await screen.findByText(/We sent a 6-digit code to moved@example.com/),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/users/me/email')?.body).toEqual({
      newEmail: 'moved@example.com',
      password: 'my passphrase',
    });

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Change email' }));

    expect(await screen.findByText(/Your email is now moved@example.com/)).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/users/me/email/confirm')?.body).toEqual({
      newEmail: 'moved@example.com',
      code: '123456',
    });
    expect(screen.getAllByText('moved@example.com').length).toBeGreaterThan(0);
  });

  it("doesn't ask a Google-only account for a password", async () => {
    const user = userEvent.setup();
    const calls = api({
      account: { ...ACCOUNT, hasPassword: false, hasGoogle: true },
      extra: (call) =>
        call.path === '/users/me/email'
          ? { status: 202, body: { data: { email: 'moved@example.com', resendAfterSeconds: 60 } } }
          : undefined,
    });
    renderRoute('/account');

    await user.type(await screen.findByLabelText('New email address'), 'moved@example.com');
    expect(screen.queryByLabelText("Password, to confirm it's you")).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Email a code to the new address' }));

    await screen.findByText(/We sent a 6-digit code/);
    expect(calls.find((c) => c.path === '/users/me/email')?.body).toEqual({
      newEmail: 'moved@example.com',
    });
  });

  it('shows why a step failed', async () => {
    const user = userEvent.setup();
    api({
      extra: (call) =>
        call.path === '/users/me/email'
          ? {
              status: 403,
              body: {
                error: { code: 'PASSWORD_INCORRECT', message: 'That password is not correct' },
              },
            }
          : undefined,
    });
    renderRoute('/account');

    await user.type(await screen.findByLabelText('New email address'), 'moved@example.com');
    await user.type(screen.getByLabelText("Password, to confirm it's you"), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Email a code to the new address' }));

    expect(await screen.findByText('That password is not correct')).toBeInTheDocument();
  });

  it('offers the data download as a plain link to the export', async () => {
    api();
    renderRoute('/account');

    const link = await screen.findByRole('link', { name: 'Download my data' });
    expect(link).toHaveAttribute('href', '/api/v1/users/me/export');
    expect(link).toHaveAttribute('download');
  });

  it('hides the email change from the admin (the server settings own that address)', async () => {
    api({ account: { ...ACCOUNT, role: 'admin' } });
    renderRoute('/account');

    await screen.findByRole('heading', { name: 'Your account' });
    expect(screen.queryByRole('heading', { name: 'Email address' })).not.toBeInTheDocument();
  });
});

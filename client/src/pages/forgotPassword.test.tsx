/** Forgot password (/forgot-password), linked from the login page. */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Call, MockResponse } from '../test/utils.tsx';
import { SIGNED_OUT, USER, mockApi, renderRoute } from '../test/utils.tsx';

function api(extra: (call: Call) => MockResponse | undefined = () => undefined) {
  return mockApi((call) => {
    const answer = extra(call);
    if (answer) return answer;
    if (call.path === '/auth/session') return SIGNED_OUT;
    if (call.path === '/auth/providers') {
      return { body: { data: { google: true, emailSignup: true } } };
    }
    if (call.path === '/users/me') {
      return { body: { data: { ...USER, hasPassword: true, hasGoogle: false } } };
    }
    if (call.path === '/commissions')
      return { body: { data: [], meta: { page: 1, pageSize: 50, total: 0 } } };
    return undefined;
  });
}

describe('Forgot password', () => {
  it('is linked from the login page, carrying the email typed there', async () => {
    const user = userEvent.setup();
    api();
    const { router } = renderRoute('/login');

    await user.type(await screen.findByLabelText('Email'), 'client@example.com');
    await user.click(screen.getByRole('link', { name: 'Forgot your password?' }));

    expect(router.state.location.pathname).toBe('/forgot-password');
    expect(await screen.findByLabelText('Email')).toHaveValue('client@example.com');
  });

  it('sends a code, then sets the new password and signs in', async () => {
    const user = userEvent.setup();
    const calls = api((call) => {
      if (call.path === '/auth/password-reset/start') {
        return {
          status: 202,
          body: { data: { email: 'client@example.com', resendAfterSeconds: 60 } },
        };
      }
      if (call.path === '/auth/password-reset/complete') return { body: { data: USER } };
      return undefined;
    });
    const { router } = renderRoute('/forgot-password');

    await user.type(await screen.findByLabelText('Email'), 'client@example.com');
    await user.click(screen.getByRole('button', { name: 'Email me a code' }));

    // The same message whether or not the address has an account.
    expect(
      await screen.findByText(/If client@example.com has an account, we sent it a 6-digit code/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ })).toBeDisabled();

    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'a brand new long password');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    // The account page loads several things first; under a full parallel run that can take
    // longer than the default second (this was a flaky failure), so allow up to five.
    expect(
      await screen.findByRole('heading', { name: 'Your account' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account');
    expect(calls.find((c) => c.path === '/auth/password-reset/complete')?.body).toEqual({
      email: 'client@example.com',
      code: '123456',
      newPassword: 'a brand new long password',
    });
  });

  it('shows a wrong code, and lets the visitor go back to change the address', async () => {
    const user = userEvent.setup();
    api((call) => {
      if (call.path === '/auth/password-reset/start') {
        return {
          status: 202,
          body: { data: { email: 'client@example.com', resendAfterSeconds: 60 } },
        };
      }
      if (call.path === '/auth/password-reset/complete') {
        return {
          status: 422,
          body: {
            error: { code: 'CODE_INCORRECT', message: "That code isn't right. 4 tries left." },
          },
        };
      }
      return undefined;
    });
    renderRoute('/forgot-password?email=client@example.com');

    await user.click(await screen.findByRole('button', { name: 'Email me a code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '000000');
    await user.type(screen.getByLabelText('New password'), 'a brand new long password');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText("That code isn't right. 4 tries left.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toHaveValue('client@example.com');
  });

  it('goes to the code step when a code was sent moments ago (429)', async () => {
    const user = userEvent.setup();
    api((call) =>
      call.path === '/auth/password-reset/start'
        ? {
            status: 429,
            body: {
              error: {
                code: 'CODE_RESEND_TOO_SOON',
                message: 'Please wait 42 seconds before asking for another code',
                details: { retryAfterSeconds: 42 },
              },
            },
          }
        : undefined,
    );
    renderRoute('/forgot-password?email=client@example.com');

    await user.click(await screen.findByRole('button', { name: 'Email me a code' }));

    expect(await screen.findByLabelText('6-digit code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send a new code in 4\ds/ })).toBeDisabled();
  });
});

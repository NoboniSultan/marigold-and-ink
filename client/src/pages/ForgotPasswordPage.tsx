import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, fieldErrors, formMessage } from '../api/client.ts';
import { authApi } from '../api/endpoints.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { FormField } from '../components/FormField.tsx';
import { useCountdown } from '../hooks/useCountdown.ts';
import buttonStyles from '../components/Button.module.css';
import styles from './SimplePage.module.css';

/**
 * Forgot password, in two steps like sign-up: (1) the email, and a 6-digit code is sent if
 * it has an account; (2) the code and a new password, which signs this browser in (and
 * every other device out). The first step answers the same for any address, so the page
 * never says whether an account exists.
 */
export function ForgotPasswordPage() {
  const { user, completePasswordReset } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useCountdown();

  if (user && !submitting) return <Navigate to="/account" replace />;

  async function sendCode() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await authApi.passwordResetStart({ email });
      setResendIn(result.resendAfterSeconds);
      setStep('code');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CODE_RESEND_TOO_SOON') {
        const wait = (err.details as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60;
        setResendIn(wait);
        setStep('code');
      }
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode();
  }

  async function onSubmitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await completePasswordReset({
        email,
        code: String(form.get('code')).trim(),
        newPassword: String(form.get('newPassword')),
      });
      navigate('/account', { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  const fields = fieldErrors(error);
  const errorBox = error ? (
    <p className={styles.formError} role="alert">
      {formMessage(error)}
    </p>
  ) : null;

  return (
    <section className={styles.page}>
      <h1>Reset your password</h1>

      {/* Keys: each step gets fresh inputs; without them React would reuse the email input
          (and the address typed into it) as the code input, since the layouts line up. */}
      {step === 'email' ? (
        <form key="email" className={styles.form} onSubmit={onSubmitEmail} noValidate>
          <p>Enter your account's email address and we'll send you a 6-digit code.</p>
          {errorBox}
          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fields.email}
          />
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
            disabled={submitting}
          >
            {submitting ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form key="code" className={styles.form} onSubmit={onSubmitCode} noValidate>
          <p className={styles.notice} role="status">
            If {email} has an account, we sent it a 6-digit code. It works for 15 minutes. Accounts
            that sign in with Google can use this to add a password.
          </p>
          {errorBox}
          <FormField
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            error={fields.code}
          />
          <FormField
            label="New password"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            hint="At least 12 characters. A short sentence works well."
            error={fields.newPassword}
          />
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : 'Set new password'}
          </button>
          <p className={styles.row}>
            <button
              type="button"
              className={styles.linkButton}
              onClick={sendCode}
              disabled={resendIn > 0 || submitting}
            >
              {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
            </button>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setStep('email');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </p>
        </form>
      )}

      <p className={styles.switch}>
        Remembered it? <Link to="/login">Log in</Link>
      </p>
    </section>
  );
}

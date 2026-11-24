import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, fieldErrors, formMessage } from '../api/client.ts';
import { authApi } from '../api/endpoints.ts';
import { useProviders } from '../api/queries.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { GoogleButton } from '../auth/GoogleButton.tsx';
import { safeNextPath } from '../auth/RequireAuth.tsx';
import { FormField } from '../components/FormField.tsx';
import { useCountdown } from '../hooks/useCountdown.ts';
import buttonStyles from '../components/Button.module.css';
import styles from './SimplePage.module.css';

/** The server enforces the same rule; this only explains it up front. */
const PASSWORD_HINT = 'At least 12 characters. A short sentence works well.';

/**
 * Sign-up in two steps: (1) email, and we send a 6-digit code; (2) the code plus name and
 * password. The account only exists once the code is entered, and then it's logged in.
 */
export function RegisterPage() {
  const { user, completeSignup } = useAuth();
  const providers = useProviders();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useCountdown();

  if (user && !submitting) return <Navigate to={next} replace />;

  async function sendCode() {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await authApi.signupStart({ email });
      setResendIn(result.resendAfterSeconds);
      setStep('code');
      setNotice(`We sent a 6-digit code to ${result.email}. It works for 15 minutes.`);
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
      await completeSignup({
        email,
        code: String(form.get('code')).trim(),
        displayName: String(form.get('displayName')),
        password: String(form.get('password')),
      });
      navigate(next, { replace: true });
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
  const loginLink = `/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`;
  const emailSignupOff = providers.data && !providers.data.emailSignup;

  return (
    <section className={styles.page}>
      <h1>Create an account</h1>

      <div className={styles.alternatives}>
        <GoogleButton next={next} />
      </div>

      {emailSignupOff ? (
        <p className={styles.notice}>Sign-up by email opens soon.</p>
      ) : step === 'email' ? (
        <form key="email" className={styles.form} onSubmit={onSubmitEmail} noValidate>
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
          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}
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
            label="Your name"
            name="displayName"
            autoComplete="name"
            required
            error={fields.displayName}
          />
          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            hint={PASSWORD_HINT}
            error={fields.password}
          />
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
            disabled={submitting}
          >
            {submitting ? 'Creating your account…' : 'Create account'}
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
                setNotice(null);
              }}
            >
              Use a different email
            </button>
          </p>
        </form>
      )}

      <p className={styles.switch}>
        Already have an account? <Link to={loginLink}>Log in</Link>
      </p>
    </section>
  );
}

import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { ApiError, fieldErrors, formMessage } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { GOOGLE_ERRORS, GoogleButton } from '../auth/GoogleButton.tsx';
import { safeNextPath } from '../auth/RequireAuth.tsx';
import { FormField } from '../components/FormField.tsx';
import buttonStyles from '../components/Button.module.css';
import styles from './SimplePage.module.css';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user && !submitting) return <Navigate to={next} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await login({ email: String(form.get('email')), password: String(form.get('password')) });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  const fields = fieldErrors(error);
  const withNext = (path: string, extra: Record<string, string> = {}) => {
    const query = new URLSearchParams(extra);
    if (params.get('next')) query.set('next', next);
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  };
  // Sent back here by a failed Google sign-in (?error=google_...).
  const googleError = GOOGLE_ERRORS[params.get('error') ?? ''];
  const notVerified = error instanceof ApiError && error.code === 'EMAIL_NOT_VERIFIED';

  return (
    <section className={styles.page}>
      <h1>Log in</h1>
      {googleError && (
        <p className={styles.formError} role="alert">
          {googleError}
        </p>
      )}
      <div className={styles.alternatives}>
        <GoogleButton next={next} />
      </div>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {formMessage(error)}{' '}
            {notVerified && <Link to={withNext('/register', { email })}>Get a code</Link>}
          </p>
        ) : null}
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
        <FormField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={fields.password}
        />
        <p className={styles.row}>
          <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}>
            Forgot your password?
          </Link>
        </p>
        <button
          type="submit"
          className={`${buttonStyles.button} ${buttonStyles.primary}`}
          disabled={submitting}
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className={styles.switch}>
        New here? <Link to={withNext('/register')}>Create an account</Link>
      </p>
    </section>
  );
}

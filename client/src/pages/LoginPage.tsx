import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { fieldErrors, formMessage } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
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
  const registerLink = params.get('next')
    ? `/register?next=${encodeURIComponent(next)}`
    : '/register';

  return (
    <section className={styles.page}>
      <h1>Log in</h1>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {formMessage(error)}
          </p>
        ) : null}
        <FormField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
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
        <button
          type="submit"
          className={`${buttonStyles.button} ${buttonStyles.primary}`}
          disabled={submitting}
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className={styles.switch}>
        New here? <Link to={registerLink}>Create an account</Link>
      </p>
    </section>
  );
}

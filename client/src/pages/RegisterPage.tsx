import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { fieldErrors, formMessage } from '../api/client.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { safeNextPath } from '../auth/RequireAuth.tsx';
import { FormField } from '../components/FormField.tsx';
import buttonStyles from '../components/Button.module.css';
import styles from './SimplePage.module.css';

/** The server enforces the same rule; this only explains it up front. */
const PASSWORD_HINT = 'At least 12 characters. A short sentence works well.';

export function RegisterPage() {
  const { user, register } = useAuth();
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
      await register({
        displayName: String(form.get('displayName')),
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  const fields = fieldErrors(error);

  return (
    <section className={styles.page}>
      <h1>Create an account</h1>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {formMessage(error)}
          </p>
        ) : null}
        <FormField
          label="Your name"
          name="displayName"
          autoComplete="name"
          required
          error={fields.displayName}
        />
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
      </form>
      <p className={styles.switch}>
        Already have an account?{' '}
        <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`}>
          Log in
        </Link>
      </p>
    </section>
  );
}

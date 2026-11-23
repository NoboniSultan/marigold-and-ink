import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Account } from '@shared/types/user.ts';
import { ApiError, fieldErrors, formMessage } from '../api/client.ts';
import { accountApi } from '../api/endpoints.ts';
import { queryKeys, useAccount, useMyCommissions } from '../api/queries.ts';
import { FormField } from '../components/FormField.tsx';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import { STATUS_TEXT } from '../features/commissions/statusText.ts';
import styles from './SimplePage.module.css';

/** The signed-in user's account: details, commissions, password, and deletion. */
export function AccountPage() {
  const account = useAccount();

  if (account.isPending) return <Loading label="Loading your account" />;
  if (account.isError) {
    return <ErrorMessage message="Your account couldn't load." onRetry={() => account.refetch()} />;
  }

  return (
    <article className={`${styles.page} ${styles.wide}`}>
      <h1>Your account</h1>
      <ProfileSection account={account.data} />
      <CommissionsSection />
      <PasswordSection account={account.data} />
      <DeleteSection account={account.data} />
    </article>
  );
}

function ProfileSection({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await accountApi.update({ displayName });
      queryClient.setQueryData(queryKeys.account, updated);
      queryClient.setQueryData(queryKeys.me, (me: object | null | undefined) =>
        me ? { ...me, displayName: updated.displayName } : me,
      );
      setDisplayName(updated.displayName);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const methods = [account.hasPassword && 'email and password', account.hasGoogle && 'Google']
    .filter(Boolean)
    .join(' or ');

  return (
    <section className={styles.section} aria-labelledby="profile-heading">
      <h2 id="profile-heading">Your details</h2>
      <dl className={styles.facts}>
        <dt>Email</dt>
        <dd className={styles.asWritten}>{account.email}</dd>
        <dt>Sign in with</dt>
        <dd className={styles.asWritten}>{methods}</dd>
      </dl>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {formMessage(error)}
          </p>
        ) : null}
        <FormField
          label="Name"
          name="displayName"
          autoComplete="name"
          required
          maxLength={100}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors(error).displayName}
        />
        <div>
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.primary}`}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save name'}
          </button>
        </div>
        {saved && <p role="status">Your name is saved.</p>}
      </form>
    </section>
  );
}

function CommissionsSection() {
  const commissions = useMyCommissions();

  return (
    <section className={styles.section} aria-labelledby="commissions-heading">
      <h2 id="commissions-heading">Your commissions</h2>
      {commissions.isPending && <Loading label="Loading your commissions" />}
      {commissions.isError && (
        <ErrorMessage
          message="Your commissions couldn't load."
          onRetry={() => commissions.refetch()}
        />
      )}
      {commissions.data &&
        (commissions.data.data.length === 0 ? (
          <p>
            No commissions yet. <Link to="/commission">Request one</Link>.
          </p>
        ) : (
          <ul className={styles.list}>
            {commissions.data.data.map((c) => (
              <li key={c.id}>
                <Link to={`/commissions/${c.id}`}>Request #{c.id}</Link>: {c.size} {c.medium}.{' '}
                {STATUS_TEXT[c.status]}
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}

function PasswordSection({ account }: { account: Account }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  if (!account.hasPassword) {
    return (
      <section className={styles.section} aria-labelledby="password-heading">
        <h2 id="password-heading">Password</h2>
        <p>You sign in with Google, so there's no password to change.</p>
      </section>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await accountApi.changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const fields = fieldErrors(error);
  return (
    <section className={styles.section} aria-labelledby="password-heading">
      <h2 id="password-heading">Password</h2>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {formMessage(error)}
          </p>
        ) : null}
        <FormField
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          error={fields.currentPassword}
        />
        <FormField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          hint="At least 12 characters."
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={fields.newPassword}
        />
        <div>
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Change password'}
          </button>
        </div>
        {saved && (
          <p role="status">Your password is changed. Other devices have been signed out.</p>
        )}
      </form>
    </section>
  );
}

function DeleteSection({ account }: { account: Account }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (account.role === 'admin') return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setDeleting(true);
    setError(null);
    try {
      await accountApi.delete(
        account.hasPassword ? { password: confirmation } : { confirmEmail: confirmation },
      );
      // Signed out, as after logging out; then drop the deleted account's private data.
      navigate('/', { replace: true });
      queryClient.setQueryData(queryKeys.me, null);
      for (const key of [
        queryKeys.account,
        queryKeys.myCommissions,
        ['commission'],
        ['payments'],
      ]) {
        queryClient.removeQueries({ queryKey: key });
      }
    } catch (err) {
      setError(err);
      setDeleting(false);
    }
  }

  const activeIds =
    error instanceof ApiError && error.code === 'ACTIVE_COMMISSIONS'
      ? ((error.details as { commissionIds?: number[] })?.commissionIds ?? [])
      : [];

  return (
    <section className={styles.section} aria-labelledby="delete-heading">
      <h2 id="delete-heading">Delete your account</h2>
      <p>
        This removes your name, email, and sign-in details, and signs you out everywhere. Requests
        that haven't been paid for are cancelled. Records of past payments are kept without your
        details, for the shop's accounts. This can't be undone.
      </p>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {formMessage(error)}{' '}
            {activeIds.map((id) => (
              <Link key={id} to={`/commissions/${id}`}>
                Request #{id}
              </Link>
            ))}
          </p>
        ) : null}
        {account.hasPassword ? (
          <FormField
            label="Your password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        ) : (
          <FormField
            label="Type your email address to confirm"
            name="confirmEmail"
            type="email"
            autoComplete="off"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        )}
        <div>
          <button
            type="submit"
            className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            disabled={deleting || confirmation.trim() === ''}
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </section>
  );
}

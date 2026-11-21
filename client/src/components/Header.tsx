import { Link, NavLink, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.tsx';
import { COPY } from '../content/copy.ts';
import styles from './Header.module.css';
import buttonStyles from './Button.module.css';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navLink} ${styles.active}` : styles.navLink;

export function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand} aria-label="Marigold & Ink, home">
          {/* The square logo, kept whole with a thin Ink border. */}
          <img
            src="/brand/logo-128.webp"
            srcSet="/brand/logo-128.webp 128w, /brand/logo-256.webp 256w"
            sizes="48px"
            width={48}
            height={48}
            alt=""
            className={styles.logo}
          />
          <span className={styles.wordmark}>Marigold &amp; Ink</span>
        </Link>

        <nav aria-label="Main" className={styles.nav}>
          <NavLink to="/gallery" className={navClass}>
            Gallery
          </NavLink>
          <NavLink to="/about" className={navClass}>
            About
          </NavLink>
          {user ? (
            <button type="button" className={styles.navButton} onClick={handleLogout}>
              Log out
            </button>
          ) : (
            <NavLink to="/login" className={navClass}>
              Log in
            </NavLink>
          )}
          <Link
            to="/commission"
            className={`${buttonStyles.button} ${buttonStyles.primary} ${styles.cta}`}
          >
            {COPY.primaryCta}
          </Link>
        </nav>
      </div>
    </header>
  );
}

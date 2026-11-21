import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { Header } from './Header.tsx';
import { Footer } from './Footer.tsx';
import styles from './Layout.module.css';

/**
 * Page shell: header, page, footer. On a route change the new page fades in quickly.
 *
 * Why not a full crossfade (old page fading out)? Keeping the old page mounted during its
 * exit means it re-renders against the *new* URL; in testing that sent the login guard
 * into a redirect loop. A quick fade-in gives the same calm feel without that class of bug.
 * See docs/motion.md.
 */
export function Layout() {
  const location = useLocation();

  // A new page starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skipLink}>
        Skip to content
      </a>
      <Header />
      <motion.main
        id="main"
        // A new key per path remounts the wrapper, which replays the fade-in.
        key={location.pathname}
        className={styles.main}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      >
        <Outlet />
      </motion.main>
      <Footer />
    </div>
  );
}

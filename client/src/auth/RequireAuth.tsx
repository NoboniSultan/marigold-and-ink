import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext.tsx';
import { Loading } from '../components/Loading.tsx';

/**
 * Protects a page: logged-out visitors go to /login, which sends them back here afterwards
 * (`?next=`). This is a convenience, not security: the API enforces access on every request.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <Loading label="Checking your session" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

/** Only allows same-site paths as a post-login destination, so ?next= can't redirect off-site. */
export function safeNextPath(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

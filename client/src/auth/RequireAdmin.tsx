import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext.tsx';
import { Loading } from '../components/Loading.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';

/**
 * Admin-only pages: signed-out visitors go to log in; anyone else sees "not found", so the
 * admin area isn't advertised. A convenience only: the API refuses non-admins on its own.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <Loading label="Checking your session" />;
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (user.role !== 'admin') return <NotFoundPage />;
  return children;
}

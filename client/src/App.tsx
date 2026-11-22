import { useState } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { createQueryClient } from './api/queryClient.ts';
import { AuthProvider } from './auth/AuthContext.tsx';
import { RequireAuth } from './auth/RequireAuth.tsx';
import { Layout } from './components/Layout.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { GalleryPage } from './pages/GalleryPage.tsx';
import { ArtworkPage } from './pages/ArtworkPage.tsx';
import { AboutPage } from './pages/AboutPage.tsx';
import { CommissionPage } from './pages/CommissionPage.tsx';
import { CommissionStatusPage } from './pages/CommissionStatusPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { RegisterPage } from './pages/RegisterPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';

/** Every page, under the shared layout. Exported so tests can mount the same routes. */
export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'gallery', element: <GalleryPage /> },
      { path: 'gallery/:slug', element: <ArtworkPage /> },
      { path: 'about', element: <AboutPage /> },
      {
        path: 'commission',
        element: (
          <RequireAuth>
            <CommissionPage />
          </RequireAuth>
        ),
      },
      {
        // Stripe sends the client back here after paying (?payment=success|cancelled).
        path: 'commissions/:id',
        element: (
          <RequireAuth>
            <CommissionStatusPage />
          </RequireAuth>
        ),
      },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function App() {
  // Created once per app, inside state, so React Strict Mode's double render can't make two.
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* "user": Motion turns transform animations into fades when reduced motion is on. */}
        <MotionConfig reducedMotion="user">
          <RouterProvider router={router} />
        </MotionConfig>
      </AuthProvider>
    </QueryClientProvider>
  );
}

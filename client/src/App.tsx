import { useState } from 'react';
import { Navigate, createBrowserRouter, type RouteObject } from 'react-router';
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
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { AccountPage } from './pages/AccountPage.tsx';

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
        path: 'privacy',
        // Loaded on demand: the policy's text shouldn't weigh on every other page.
        lazy: async () => ({ Component: (await import('./pages/PrivacyPage.tsx')).PrivacyPage }),
      },
      {
        path: 'terms',
        lazy: async () => ({ Component: (await import('./pages/TermsPage.tsx')).TermsPage }),
      },
      {
        // Loaded on demand: the tree morph's library (flubber) is only needed here.
        path: 'giving',
        lazy: async () => ({ Component: (await import('./pages/GivingPage.tsx')).GivingPage }),
      },
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
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      {
        // The admin area: its pages load on demand, so visitors never download them.
        path: 'admin',
        lazy: async () => ({
          Component: (await import('./pages/admin/AdminLayout.tsx')).AdminLayout,
        }),
        children: [
          { index: true, element: <Navigate to="commissions" replace /> },
          {
            path: 'commissions',
            lazy: async () => ({
              Component: (await import('./pages/admin/AdminCommissionsPage.tsx'))
                .AdminCommissionsPage,
            }),
          },
          {
            path: 'commissions/:id',
            lazy: async () => ({
              Component: (await import('./pages/admin/AdminCommissionPage.tsx'))
                .AdminCommissionPage,
            }),
          },
          {
            path: 'giving',
            lazy: async () => ({
              Component: (await import('./pages/admin/AdminGivingPage.tsx')).AdminGivingPage,
            }),
          },
          {
            path: 'report',
            lazy: async () => ({
              Component: (await import('./pages/admin/AdminReportPage.tsx')).AdminReportPage,
            }),
          },
        ],
      },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
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

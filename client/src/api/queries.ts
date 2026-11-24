/**
 * TanStack Query hooks. Query keys are built in one place so a cache entry can be read,
 * refreshed, or invalidated reliably (e.g. after login, `queryKeys.me` is updated).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError } from './client.ts';
import {
  aboutApi,
  accountApi,
  adminApi,
  givingApi,
  artworksApi,
  authApi,
  commissionsApi,
  paymentsApi,
  type ArtworkFilters,
} from './endpoints.ts';

export const queryKeys = {
  commission: (id: number) => ['commission', id] as const,
  payments: (commissionId: number) => ['payments', commissionId] as const,
  me: ['me'] as const,
  account: ['account'] as const,
  myCommissions: ['my-commissions'] as const,
  artworks: (filters: ArtworkFilters) => ['artworks', filters] as const,
  artwork: (slug: string) => ['artwork', slug] as const,
  categories: ['categories'] as const,
  tags: ['tags'] as const,
  about: ['about'] as const,
  giving: ['giving'] as const,
  commissionOptions: ['commission-options'] as const,
  providers: ['auth-providers'] as const,
  // The admin screens. Everything under 'admin' is refreshed together after a change.
  admin: ['admin'] as const,
  adminCommissions: (filters: { page: number; status?: string }) =>
    ['admin', 'commissions', filters] as const,
  adminCommission: (id: number) => ['admin', 'commission', id] as const,
  adminQuote: (id: number) => ['admin', 'quote', id] as const,
  adminDonations: (filters: { page: number; status: string }) =>
    ['admin', 'donations', filters] as const,
  monthlyReport: (year: number) => ['admin', 'report', year] as const,
};

export function useArtworks(filters: ArtworkFilters) {
  return useQuery({
    queryKey: queryKeys.artworks(filters),
    queryFn: ({ signal }) => artworksApi.list(filters, signal),
    // Keep showing the current page while the next one loads, instead of flashing empty.
    placeholderData: keepPreviousData,
  });
}

export function useArtwork(slug: string) {
  return useQuery({
    queryKey: queryKeys.artwork(slug),
    queryFn: ({ signal }) => artworksApi.get(slug, signal),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => artworksApi.categories(signal),
  });
}

export function useTags() {
  return useQuery({ queryKey: queryKeys.tags, queryFn: ({ signal }) => artworksApi.tags(signal) });
}

export function useAbout() {
  return useQuery({ queryKey: queryKeys.about, queryFn: ({ signal }) => aboutApi.get(signal) });
}

/** The Giving page's running total of trees funded. */
export function useGiving() {
  return useQuery({
    queryKey: queryKeys.giving,
    queryFn: ({ signal }) => givingApi.totals(signal),
  });
}

export function useCommissionOptions() {
  return useQuery({
    queryKey: queryKeys.commissionOptions,
    queryFn: ({ signal }) => commissionsApi.options(signal),
  });
}

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: ({ signal }) => authApi.me(signal),
    staleTime: 5 * 60_000,
  });
}

/** The account page: the signed-in user plus their sign-in methods. */
export function useAccount() {
  return useQuery({ queryKey: queryKeys.account, queryFn: ({ signal }) => accountApi.get(signal) });
}

export function useMyCommissions() {
  return useQuery({
    queryKey: queryKeys.myCommissions,
    queryFn: ({ signal }) => commissionsApi.mine(signal),
  });
}

/** Which sign-in methods the server has switched on (Google, email sign-up). */
export function useProviders() {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: ({ signal }) => authApi.providers(signal),
    staleTime: Infinity,
  });
}

/** Where "Continue with Google" goes: a full-page navigation to the server, then Google. */
export function googleStartUrl(next: string): string {
  return `/api/v1/auth/google/start?next=${encodeURIComponent(next)}`;
}

/**
 * One commission. `pollMs` refetches on that interval while set: the page uses it right
 * after Stripe sends the client back, until the webhook has moved the status on.
 */
export function useCommission(id: number, { pollMs }: { pollMs?: number | false } = {}) {
  return useQuery({
    queryKey: queryKeys.commission(id),
    queryFn: ({ signal }) => commissionsApi.get(id, signal),
    refetchInterval: pollMs ?? false,
  });
}

export function usePayments(commissionId: number, { pollMs }: { pollMs?: number | false } = {}) {
  return useQuery({
    queryKey: queryKeys.payments(commissionId),
    queryFn: ({ signal }) => paymentsApi.list(commissionId, signal),
    refetchInterval: pollMs ?? false,
  });
}

// --- The admin screens ---

export function useAdminCommissions(filters: { page: number; status?: string }) {
  return useQuery({
    queryKey: queryKeys.adminCommissions(filters),
    queryFn: ({ signal }) => adminApi.commissions(filters, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminCommission(id: number) {
  return useQuery({
    queryKey: queryKeys.adminCommission(id),
    queryFn: ({ signal }) => adminApi.commission(id, signal),
  });
}

/** The commission's current quote, or null before one is generated (the API answers 404). */
export function useAdminQuote(id: number) {
  return useQuery({
    queryKey: queryKeys.adminQuote(id),
    queryFn: async ({ signal }) => {
      try {
        return await adminApi.quote(id, signal);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useAdminDonations(filters: {
  page: number;
  status: 'pending' | 'owed' | 'paid' | 'reversed';
}) {
  return useQuery({
    queryKey: queryKeys.adminDonations(filters),
    queryFn: ({ signal }) => adminApi.donations(filters, signal),
    placeholderData: keepPreviousData,
  });
}

export function useMonthlyReport(year: number) {
  return useQuery({
    queryKey: queryKeys.monthlyReport(year),
    queryFn: ({ signal }) => adminApi.monthlyReport(year, signal),
  });
}

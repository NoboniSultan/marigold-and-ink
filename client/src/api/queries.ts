/**
 * TanStack Query hooks. Query keys are built in one place so a cache entry can be read,
 * refreshed, or invalidated reliably (e.g. after login, `queryKeys.me` is updated).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  aboutApi,
  artworksApi,
  authApi,
  commissionsApi,
  type ArtworkFilters,
} from './endpoints.ts';

export const queryKeys = {
  me: ['me'] as const,
  artworks: (filters: ArtworkFilters) => ['artworks', filters] as const,
  artwork: (slug: string) => ['artwork', slug] as const,
  categories: ['categories'] as const,
  tags: ['tags'] as const,
  about: ['about'] as const,
  commissionOptions: ['commission-options'] as const,
  providers: ['auth-providers'] as const,
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

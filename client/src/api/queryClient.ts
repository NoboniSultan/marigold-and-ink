import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client.ts';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Gallery content changes only with a deploy, so a minute of freshness is plenty.
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        // Retry network hiccups and server errors, but not answers like 404 or 401.
        retry: (failureCount, error) =>
          failureCount < 2 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}

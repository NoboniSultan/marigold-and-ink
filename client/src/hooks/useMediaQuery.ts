import { useSyncExternalStore } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * Subscribes to a CSS media query. useSyncExternalStore is React's tool for reading
 * outside state (here: the browser's media query list) without tearing between renders.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True when the visitor asked their OS for less motion. Every animation checks this. */
export function usePrefersReducedMotion(): boolean {
  return useReducedMotion() ?? false;
}

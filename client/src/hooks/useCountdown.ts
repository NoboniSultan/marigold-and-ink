import { useEffect, useState } from 'react';

/**
 * Seconds left before another emailed code may be sent; counts down once a second.
 * Used by sign-up, forgot password, and the account page's email change.
 */
export function useCountdown() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);
  return [seconds, setSeconds] as const;
}

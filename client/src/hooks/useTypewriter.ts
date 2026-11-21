import { useEffect, useState } from 'react';

/**
 * Typewriter effect, no library. The logic is a pure step function (`nextStep`): given
 * what's on screen and the lines to show, it returns the next screen state and how long to
 * wait before showing it. The hook only runs that function on a timer, which keeps the
 * rhythm testable without real time.
 *
 * Rhythm: type each character at an uneven, human pace (a little slower after spaces and
 * punctuation), hold the finished line, erase faster than typing, pause, type the next.
 * If `lines` changes, whatever is on screen no longer matches, so it is erased and the new
 * text typed: "erase, then retype when the text changes".
 */

export interface TypewriterState {
  /** Which line is being typed (wraps around). */
  index: number;
  /** The text currently on screen. */
  typed: string;
  phase: 'typing' | 'erasing';
}

export const TIMING = {
  typeMin: 55,
  typeJitter: 70,
  afterWordExtra: 90,
  hold: 1800,
  eraseMin: 28,
  eraseJitter: 18,
  beforeNextLine: 450,
} as const;

export const INITIAL_STATE: TypewriterState = { index: 0, typed: '', phase: 'typing' };

/** Returns the next state and the delay before it, or null when there's nothing more to do. */
export function nextStep(
  state: TypewriterState,
  lines: readonly string[],
  random: () => number = Math.random,
): { next: TypewriterState; delay: number } | null {
  if (lines.length === 0) return null;
  const target = lines[state.index % lines.length] ?? '';

  if (state.phase === 'typing') {
    if (!target.startsWith(state.typed)) {
      return { next: { ...state, phase: 'erasing' }, delay: 0 };
    }
    if (state.typed.length < target.length) {
      const char = target[state.typed.length]!;
      const pauseAfterWord = /[\s,.;:!?]/.test(state.typed.at(-1) ?? '')
        ? TIMING.afterWordExtra
        : 0;
      return {
        next: { ...state, typed: state.typed + char },
        delay: TIMING.typeMin + random() * TIMING.typeJitter + pauseAfterWord,
      };
    }
    // The line is complete. With a single line there is nothing to cycle to.
    if (lines.length === 1) return null;
    return { next: { ...state, phase: 'erasing' }, delay: TIMING.hold };
  }

  if (state.typed.length > 0) {
    return {
      next: { ...state, typed: state.typed.slice(0, -1) },
      delay: TIMING.eraseMin + random() * TIMING.eraseJitter,
    };
  }
  return {
    next: { index: (state.index + 1) % lines.length, typed: '', phase: 'typing' },
    delay: TIMING.beforeNextLine,
  };
}

/**
 * @param lines   Keep the array stable (a constant or memoized); a new array restarts the cycle.
 * @param animate False (e.g. reduced motion) shows the first line at once, without typing.
 */
export function useTypewriter(lines: readonly string[], { animate = true } = {}) {
  const [state, setState] = useState<TypewriterState>(INITIAL_STATE);

  useEffect(() => {
    if (!animate) return;
    const step = nextStep(state, lines);
    if (!step) return;
    const timer = setTimeout(() => setState(step.next), step.delay);
    return () => clearTimeout(timer);
  }, [state, lines, animate]);

  return {
    text: animate ? state.typed : (lines[0] ?? ''),
    isErasing: animate && state.phase === 'erasing',
  };
}

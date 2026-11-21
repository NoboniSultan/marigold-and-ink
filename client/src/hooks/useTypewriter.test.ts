import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  INITIAL_STATE,
  TIMING,
  nextStep,
  useTypewriter,
  type TypewriterState,
} from './useTypewriter.ts';

const noJitter = () => 0;
const maxJitter = () => 0.9999;

/** Runs the step function until it stops or `limit` steps pass; returns every state. */
function run(lines: string[], start: TypewriterState = INITIAL_STATE, limit = 200) {
  const states = [start];
  let state = start;
  for (let i = 0; i < limit; i++) {
    const step = nextStep(state, lines, noJitter);
    if (!step) break;
    state = step.next;
    states.push(state);
  }
  return states;
}

describe('nextStep', () => {
  it('types one character at a time at a human pace', () => {
    const step = nextStep(INITIAL_STATE, ['Hi'], noJitter)!;
    expect(step.next.typed).toBe('H');
    expect(step.delay).toBe(TIMING.typeMin);
    expect(nextStep(INITIAL_STATE, ['Hi'], maxJitter)!.delay).toBeLessThan(
      TIMING.typeMin + TIMING.typeJitter,
    );
  });

  it('pauses a little longer after a space or punctuation', () => {
    const afterSpace = nextStep({ ...INITIAL_STATE, typed: 'a ' }, ['a b'], noJitter)!;
    const midWord = nextStep({ ...INITIAL_STATE, typed: 'a' }, ['ab'], noJitter)!;
    expect(afterSpace.delay).toBe(midWord.delay + TIMING.afterWordExtra);
  });

  it('holds a finished line, then erases faster than it typed', () => {
    const done: TypewriterState = { index: 0, typed: 'ab', phase: 'typing' };
    const hold = nextStep(done, ['ab', 'cd'], noJitter)!;
    expect(hold).toEqual({ next: { ...done, phase: 'erasing' }, delay: TIMING.hold });

    const erase = nextStep(hold.next, ['ab', 'cd'], noJitter)!;
    expect(erase.next.typed).toBe('a');
    expect(erase.delay).toBeLessThan(TIMING.typeMin);
  });

  it('cycles through every line and wraps around', () => {
    const typedLines = run(['ab', 'cd'], INITIAL_STATE, 40)
      .filter((s) => s.phase === 'erasing' && (s.typed === 'ab' || s.typed === 'cd'))
      .map((s) => s.typed);
    expect(typedLines.slice(0, 3)).toEqual(['ab', 'cd', 'ab']);
  });

  it('stops after typing a single line', () => {
    const states = run(['Hello']);
    expect(states.at(-1)).toEqual({ index: 0, typed: 'Hello', phase: 'typing' });
  });

  it('erases and retypes when the text changes', () => {
    const shown: TypewriterState = { index: 0, typed: 'Old text', phase: 'typing' };
    const states = run(['New'], shown);
    expect(states[1]!.phase).toBe('erasing');
    expect(states.some((s) => s.typed === '')).toBe(true);
    expect(states.at(-1)!.typed).toBe('New');
  });

  it('does nothing without lines', () => {
    expect(nextStep(INITIAL_STATE, [])).toBeNull();
  });
});

describe('useTypewriter', () => {
  it('shows the first line at once when animation is off (reduced motion)', () => {
    const { result } = renderHook(() => useTypewriter(['First', 'Second'], { animate: false }));
    expect(result.current.text).toBe('First');
  });

  it('starts empty and types when animating', () => {
    const { result } = renderHook(() => useTypewriter(['First']));
    expect(result.current.text).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  LEAF_GAP,
  LIFT,
  MIN_TURN_SECONDS,
  CLOSED_FRONT,
  OPEN_SECONDS,
  SEGMENTS,
  TURN_SECONDS,
  WHEEL_PAUSE_MS,
  WHEEL_THRESHOLD,
  backCoverTarget,
  clampSpread,
  createPaper,
  dragLift,
  dragProgress,
  fitInside,
  frontCoverTarget,
  heldLeaf,
  hingeProgress,
  initialWheelState,
  isNearSpread,
  isOpenSpread,
  layOutPaper,
  leafTarget,
  paperTargets,
  releaseTurns,
  settlePaper,
  stackHeight,
  stepPaper,
  turnDuration,
  turnLift,
  turnProgress,
  wheelStep,
  type WheelState,
} from './sketchbook.ts';

describe('fitInside', () => {
  it('fits a wide piece to the width and a tall one to the height, keeping proportions', () => {
    expect(fitInside(2, 1, 1)).toEqual({ width: 1, height: 0.5 });
    expect(fitInside(0.5, 1, 1)).toEqual({ width: 0.5, height: 1 });
    expect(fitInside(1, 2, 1)).toEqual({ width: 1, height: 1 });
  });
});

describe('spreads and leaves', () => {
  it('keeps the spread inside the book, from shut at the front to shut at the back', () => {
    expect(clampSpread(-5, 5)).toBe(CLOSED_FRONT);
    expect(clampSpread(9, 5)).toBe(5);
    expect(clampSpread(2, 5)).toBe(2);
    expect(clampSpread(3, 0)).toBe(0);
    expect([-1, 0, 4, 5].map((s) => isOpenSpread(s, 5))).toEqual([false, true, true, false]);
  });

  it('shuts the front cover before the first spread and the back cover after the last', () => {
    expect([-1, 0, 3].map(frontCoverTarget)).toEqual([0, 1, 1]);
    expect([3, 4, 5].map((s) => backCoverTarget(s, 5))).toEqual([0, 0, 1]);
  });

  it('lies the leaves before the current spread on the left', () => {
    expect([0, 1, 2, 3].map((leaf) => leafTarget(leaf, 2))).toEqual([1, 1, 0, 0]);
  });

  it('gives textures only to leaves near the open spread', () => {
    expect([0, 1, 3, 5, 6].map((leaf) => isNearSpread(leaf, 3))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('puts earlier leaves on top on the right, and later ones on top on the left', () => {
    expect(stackHeight(0, 3, 0)).toBeGreaterThan(stackHeight(1, 3, 0));
    expect(stackHeight(1, 3, 1)).toBeGreaterThan(stackHeight(0, 3, 1));
    expect(stackHeight(2, 3, 0)).toBeCloseTo(LEAF_GAP); // never level with the base
  });
});

describe('turn timing', () => {
  it('starts and ends where asked, easing in between', () => {
    expect(turnProgress(0, 1, 0, 1)).toBe(0);
    expect(turnProgress(0, 1, 0.5, 1)).toBeCloseTo(0.5);
    expect(turnProgress(0, 1, 0.1, 1)).toBeLessThan(0.1); // a gentle start
    expect(turnProgress(0, 1, 0.9, 1)).toBeGreaterThan(0.9); // a gentle stop
    expect(turnProgress(0, 1, 5, 1)).toBe(1);
    expect(turnProgress(1, 0, 1, 1)).toBe(0);
    expect(turnProgress(0, 1, 0, 0)).toBe(1); // no duration: straight to the end
  });

  it('takes a full turn time for a full turn, and never snaps a short one', () => {
    expect(turnDuration(1)).toBe(TURN_SECONDS);
    expect(turnDuration(-0.5)).toBe(TURN_SECONDS / 2);
    expect(turnDuration(0.05)).toBe(MIN_TURN_SECONDS);
  });

  it('lifts the edge ahead early in a turn, and lets it trail late', () => {
    expect(turnLift(0.25, 1)).toBeCloseTo(LIFT);
    expect(turnLift(0.75, 1)).toBeCloseTo(-LIFT);
    expect(turnLift(0.25, -1)).toBeCloseTo(-LIFT); // turning back: ahead is toward 0
    expect(turnLift(2, 1)).toBeCloseTo(0);
    expect(dragLift(Math.PI / 2, 1)).toBeCloseTo(LIFT);
    expect(dragLift(0, 1)).toBeCloseTo(0);
  });

  it('swings a cover over in its own time, from wherever it is', () => {
    expect(hingeProgress(0, 1, 0)).toBe(0);
    expect(hingeProgress(0, 1, OPEN_SECONDS / 2)).toBeCloseTo(0.5);
    expect(hingeProgress(0, 1, OPEN_SECONDS)).toBe(1);
    expect(hingeProgress(0.5, 0, OPEN_SECONDS / 2)).toBe(0); // halfway back: half the time
  });
});

describe('the paper', () => {
  /** Simulates a full animated turn at 60 fps, recording every frame's angles. */
  function simulateTurn(seconds = 4) {
    const paper = createPaper(0);
    const targets = new Float64Array(SEGMENTS);
    const frames: Float64Array[] = [];
    let settledAt = Infinity;
    for (let frame = 0; frame * (1 / 60) < seconds; frame++) {
      const t = frame / 60;
      const spine = Math.PI * turnProgress(0, 1, t, TURN_SECONDS);
      paperTargets(spine, turnLift(t / TURN_SECONDS, 1), targets);
      if (stepPaper(paper, targets, 1 / 60) && t > TURN_SECONDS && settledAt === Infinity) {
        settledAt = t;
      }
      frames.push(Float64Array.from(paper.angles));
    }
    return { frames, settledAt, paper };
  }

  it('turns over and comes to rest flat on the other side', () => {
    const { paper, settledAt } = simulateTurn();
    expect([...paper.angles].every((a) => a === Math.PI)).toBe(true);
    expect(settledAt).toBeLessThan(TURN_SECONDS + 1.5);
  });

  it('never passes through the book', () => {
    for (const angles of simulateTurn().frames) {
      for (const a of angles) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(Math.PI);
      }
    }
  });

  it('flows: the edge leads early and trails behind late in the turn', () => {
    const { frames } = simulateTurn();
    const edgeMinusSpine = frames.map((a) => a[SEGMENTS - 1]! - a[0]!);
    expect(Math.max(...edgeMinusSpine)).toBeGreaterThan(0.1); // lifted ahead
    expect(Math.min(...edgeMinusSpine)).toBeLessThan(-0.3); // trailing behind
  });

  it('never stretches: the page is as long as it is wide, however it bends', () => {
    const xs = new Float64Array(SEGMENTS + 1);
    const zs = new Float64Array(SEGMENTS + 1);
    for (const angles of simulateTurn(1.5).frames.filter((_, i) => i % 10 === 0)) {
      layOutPaper(angles, 1.35, xs, zs);
      let length = 0;
      for (let j = 1; j <= SEGMENTS; j++)
        length += Math.hypot(xs[j]! - xs[j - 1]!, zs[j]! - zs[j - 1]!);
      expect(length).toBeCloseTo(1.35, 6);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(0); // and stays above the pages below
    }
  });

  it('lies flat at rest', () => {
    const xs = new Float64Array(SEGMENTS + 1);
    const zs = new Float64Array(SEGMENTS + 1);
    layOutPaper(createPaper(0).angles, 1, xs, zs);
    expect(xs[SEGMENTS]).toBeCloseTo(1);
    expect(Math.max(...zs.map(Math.abs))).toBe(0);
  });

  it('jumps straight to its shape for reduced motion', () => {
    const paper = createPaper(0);
    settlePaper(paper, paperTargets(Math.PI, 0, new Float64Array(SEGMENTS)));
    expect([...paper.angles].every((a) => a === Math.PI)).toBe(true);
  });
});

describe('dragging a page', () => {
  it('follows the finger, forward from the right and back from the left', () => {
    expect(dragProgress(-50, 100, 1)).toBeCloseTo(0.5);
    expect(dragProgress(-500, 100, 1)).toBe(1);
    expect(dragProgress(30, 100, 1)).toBe(0); // the wrong way: stays put
    expect(dragProgress(25, 100, -1)).toBeCloseTo(0.75);
    expect(dragProgress(500, 100, -1)).toBe(0);
  });

  it('picks up the open page going forward and the last turned page going back', () => {
    expect(heldLeaf(0, 5, 1)).toBe(0);
    expect(heldLeaf(4, 5, 1)).toBe(4); // the last page: turning it shuts the book
    expect(heldLeaf(3, 5, -1)).toBe(2);
    // No page to hold: back from the first spread (the cover shuts), or a closed book.
    expect(heldLeaf(0, 5, -1)).toBeNull();
    expect(heldLeaf(CLOSED_FRONT, 5, 1)).toBeNull();
    expect(heldLeaf(5, 5, -1)).toBeNull();
  });

  it('carries on over past a third of the way, or with a flick', () => {
    expect(releaseTurns({ leaf: 0, direction: 1, progress: 0.4 }, 0)).toBe(true);
    expect(releaseTurns({ leaf: 0, direction: 1, progress: 0.2 }, 0)).toBe(false);
    expect(releaseTurns({ leaf: 0, direction: 1, progress: 0.1 }, -0.8)).toBe(true);
    expect(releaseTurns({ leaf: 0, direction: -1, progress: 0.6 }, 0)).toBe(true);
    expect(releaseTurns({ leaf: 0, direction: -1, progress: 0.9 }, 0)).toBe(false);
    expect(releaseTurns({ leaf: 0, direction: -1, progress: 0.9 }, 0.8)).toBe(true);
  });
});

describe('wheelStep', () => {
  const scroll = (events: [number, number][]) => {
    let state: WheelState = initialWheelState;
    const steps: number[] = [];
    for (const [delta, time] of events) {
      const result = wheelStep(state, delta, time);
      state = result.state;
      if (result.step) steps.push(result.step);
    }
    return steps;
  };

  it('turns one page once a gesture has scrolled far enough, either way', () => {
    expect(scroll([[WHEEL_THRESHOLD, 0]])).toEqual([1]);
    expect(scroll([[-WHEEL_THRESHOLD, 0]])).toEqual([-1]);
    expect(scroll([[WHEEL_THRESHOLD / 2, 0]])).toEqual([]);
  });

  it('turns only one page per swipe, however long it coasts', () => {
    const swipe = Array.from({ length: 60 }, (_, i) => [30, i * 16] as [number, number]);
    expect(scroll(swipe)).toEqual([1]);
  });

  it('turns again after a pause', () => {
    const later = WHEEL_PAUSE_MS + 50;
    expect(
      scroll([
        [WHEEL_THRESHOLD, 0],
        [WHEEL_THRESHOLD, later],
      ]),
    ).toEqual([1, 1]);
  });

  it('forgets small scrolls after a pause', () => {
    const later = WHEEL_PAUSE_MS + 50;
    expect(
      scroll([
        [WHEEL_THRESHOLD - 1, 0],
        [WHEEL_THRESHOLD - 1, later],
      ]),
    ).toEqual([]);
  });
});

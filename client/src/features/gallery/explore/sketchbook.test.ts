import { describe, expect, it } from 'vitest';
import {
  CURL,
  LEAF_GAP,
  WHEEL_PAUSE_MS,
  WHEEL_THRESHOLD,
  bendPoint,
  clampSpread,
  fitInside,
  initialWheelState,
  isNearSpread,
  leafShape,
  leafTarget,
  stackHeight,
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
  it('keeps the spread inside the book', () => {
    expect(clampSpread(-1, 5)).toBe(0);
    expect(clampSpread(9, 5)).toBe(4);
    expect(clampSpread(2, 5)).toBe(2);
    expect(clampSpread(3, 0)).toBe(0);
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
});

describe('turnProgress', () => {
  it('starts and ends where asked, easing in between', () => {
    expect(turnProgress(0, 1, 0, 1)).toBe(0);
    expect(turnProgress(0, 1, 0.5, 1)).toBeCloseTo(0.5);
    expect(turnProgress(0, 1, 0.1, 1)).toBeLessThan(0.1); // a gentle start
    expect(turnProgress(0, 1, 0.9, 1)).toBeGreaterThan(0.9); // a gentle stop
    expect(turnProgress(0, 1, 5, 1)).toBe(1);
    expect(turnProgress(1, 0, 1, 1)).toBe(0);
  });

  it('jumps straight to the end with no duration (reduced motion)', () => {
    expect(turnProgress(0, 1, 0, 0)).toBe(1);
  });
});

describe('the page bend', () => {
  it('lies flat at both ends of a turn and curls most in the middle', () => {
    expect(leafShape(0)).toEqual({ angle: 0, curl: 0 });
    expect(leafShape(1).angle).toBeCloseTo(Math.PI);
    expect(leafShape(1).curl).toBeCloseTo(0);
    expect(leafShape(0.5).curl).toBeCloseTo(CURL);
  });

  it('is a straight page without curl', () => {
    expect(bendPoint(1, 1, 0, 0)).toEqual([1, 0]);
    const [x, z] = bendPoint(1, 1, Math.PI / 2, 0);
    expect(x).toBeCloseTo(0);
    expect(z).toBeCloseTo(1);
  });

  it('never stretches the paper: the curled edge is as far along the arc as the page is wide', () => {
    // Walk along the curled page in small steps; the path length stays the width.
    const width = 1.35;
    const { angle, curl } = leafShape(0.4);
    let length = 0;
    let previous = bendPoint(0, width, angle, curl);
    for (let i = 1; i <= 200; i++) {
      const point = bendPoint((width * i) / 200, width, angle, curl);
      length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      previous = point;
    }
    expect(length).toBeCloseTo(width, 4);
  });

  it('keeps a turning page above the book', () => {
    for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const { angle, curl } = leafShape(p);
      for (const s of [0.3, 0.7, 1.35]) {
        expect(bendPoint(s, 1.35, angle, curl)[1]).toBeGreaterThan(0);
      }
    }
  });
});

describe('stackHeight', () => {
  it('puts earlier leaves on top on the right, and later ones on top on the left', () => {
    expect(stackHeight(0, 3, 0)).toBeGreaterThan(stackHeight(1, 3, 0));
    expect(stackHeight(1, 3, 1)).toBeGreaterThan(stackHeight(0, 3, 1));
    expect(stackHeight(2, 3, 0)).toBeCloseTo(LEAF_GAP); // never level with the base
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

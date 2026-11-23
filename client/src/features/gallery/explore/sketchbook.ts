/**
 * The sketchbook's arithmetic: page sizes, how a turning page bends, how far a turn has
 * got, and how scrolling becomes page turns. Pure, so it is unit-tested without WebGL.
 *
 * The book: one spread per artwork. Spread k shows artwork k's caption on the left page
 * and the artwork on the right. A leaf (one sheet of paper) has two sides: leaf i's front
 * is artwork i, and its back is artwork i + 1's caption, so turning leaf i reveals the
 * next spread. The left page of the first spread is the inside cover.
 */

/** A page, in scene units: a portrait sketchbook (about A4 proportions). */
export const PAGE_WIDTH = 1.35;
export const PAGE_HEIGHT = 1.85;
/** Margin around a drawing on its page, as a share of the page width. */
export const PAGE_MARGIN = 0.09;
/** How much a turning page curls at mid-turn, in radians from spine to outer edge. */
export const CURL = 0.55;
/** The thickness each leaf adds to its stack, so pages never flicker through each other. */
export const LEAF_GAP = 0.0012;
/** How long one page turn takes, in seconds. */
export const TURN_SECONDS = 0.9;

/** The biggest box of the given aspect (width / height) that fits inside maxWidth × maxHeight. */
export function fitInside(aspect: number, maxWidth: number, maxHeight: number) {
  return aspect >= maxWidth / maxHeight
    ? { width: maxWidth, height: maxWidth / aspect }
    : { width: maxHeight * aspect, height: maxHeight };
}

export function clampSpread(spread: number, count: number): number {
  return Math.min(Math.max(spread, 0), Math.max(count - 1, 0));
}

/** Leaves before the current spread lie turned (1, on the left); the rest lie flat (0). */
export function leafTarget(leaf: number, spread: number): 0 | 1 {
  return leaf < spread ? 1 : 0;
}

/**
 * Smooth start and stop (ease-in-out cubic), so a page lifts gently and settles gently.
 * Returns the progress `elapsed` seconds after a turn from `from` toward `to` began.
 */
export function turnProgress(from: number, to: number, elapsed: number, duration = TURN_SECONDS) {
  const t = duration <= 0 ? 1 : Math.min(Math.max(elapsed / duration, 0), 1);
  const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  return from + (to - from) * eased;
}

/**
 * A leaf's shape at turn progress p (0 = lying on the right, 1 = lying on the left):
 * the angle at the spine, and how much it curls toward the outer edge. The curl is
 * strongest mid-turn and gone at both ends, so resting pages lie flat.
 */
export function leafShape(p: number): { angle: number; curl: number } {
  return { angle: p * Math.PI, curl: CURL * Math.sin(p * Math.PI) };
}

/**
 * Where the point `s` along a page (0 at the spine, `width` at the outer edge) ends up,
 * as [x, z]: x across the book, z up off the pages.
 *
 * The page's angle changes evenly from `angle` at the spine to `angle − curl` at the
 * edge (the outer edge trails behind), so the page is a circular arc. Integrating the
 * direction (cos a, sin a) along it gives a closed form; with no curl it is a straight
 * line at `angle`. The length along the page stays `s`, so the paper never stretches.
 */
export function bendPoint(s: number, width: number, angle: number, curl: number): [number, number] {
  const k = curl / width;
  if (Math.abs(k) < 1e-9) return [s * Math.cos(angle), s * Math.sin(angle)];
  return [
    (Math.sin(angle) - Math.sin(angle - k * s)) / k,
    (Math.cos(angle - k * s) - Math.cos(angle)) / k,
  ];
}

/**
 * How high a leaf sits above the book's base, so stacked pages never overlap: on the
 * right, earlier leaves lie on top; on the left, later ones do. Mid-turn it moves
 * between the two.
 */
export function stackHeight(leaf: number, count: number, p: number): number {
  const right = (count - leaf) * LEAF_GAP;
  const left = (leaf + 1) * LEAF_GAP;
  return right + (left - right) * p;
}

/** Leaves whose pages get real textures: the ones on show or about to be. */
export function isNearSpread(leaf: number, spread: number, reach = 2): boolean {
  return leaf >= spread - reach && leaf <= spread + reach;
}

/**
 * Scroll → page turns, one turn per gesture. A trackpad swipe sends a long stream of
 * wheel events (and keeps sending them as it coasts), so after a turn the stream is
 * ignored until it pauses. That keeps paging calm: one swipe, one page.
 */
export interface WheelState {
  accumulated: number;
  armed: boolean;
  lastTime: number;
}

/** Scrolled distance (in pixels) that turns a page. */
export const WHEEL_THRESHOLD = 40;
/** A pause this long (ms) ends a gesture. */
export const WHEEL_PAUSE_MS = 220;

export const initialWheelState: WheelState = { accumulated: 0, armed: true, lastTime: -Infinity };

export function wheelStep(
  state: WheelState,
  delta: number,
  time: number,
): { state: WheelState; step: -1 | 0 | 1 } {
  const paused = time - state.lastTime > WHEEL_PAUSE_MS;
  const armed = state.armed || paused;
  const accumulated = (paused ? 0 : state.accumulated) + delta;
  if (!armed) return { state: { accumulated: 0, armed: false, lastTime: time }, step: 0 };
  if (Math.abs(accumulated) >= WHEEL_THRESHOLD) {
    return {
      state: { accumulated: 0, armed: false, lastTime: time },
      step: accumulated > 0 ? 1 : -1,
    };
  }
  return { state: { accumulated, armed: true, lastTime: time }, step: 0 };
}

/** A horizontal drag this long (in pixels) turns a page: left for next, right for back. */
export const DRAG_THRESHOLD = 50;

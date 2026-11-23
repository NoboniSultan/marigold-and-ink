/**
 * The sketchbook's arithmetic: page sizes, how a page moves like paper, how far a turn
 * has got, how the cover opens, and how scrolling and dragging become page turns. Pure,
 * so it is unit-tested without WebGL.
 *
 * The book: one spread per artwork. Spread k shows artwork k's caption on the left page
 * and the artwork on the right. A leaf (one sheet of paper) has two sides: leaf i's front
 * is artwork i, and its back is artwork i + 1's caption, so turning leaf i reveals the
 * next spread. The left page of the first spread is the inside of the front cover.
 *
 * A page is a strip of SEGMENTS pieces from the spine to the outer edge, each with its
 * own angle (0 = lying on the right, π = lying on the left). The spine end is driven by
 * the turn (or by a finger); every piece follows its target on a soft spring, stiffer near
 * the spine and looser toward the edge. So the edge lifts first, trails behind through the
 * turn, and floats down last: the motion of real paper, without a physics engine.
 */

/** A page, in scene units: a portrait sketchbook (about A4 proportions). */
export const PAGE_WIDTH = 1.35;
export const PAGE_HEIGHT = 1.85;
/** Margin around a drawing on its page, as a share of the page width. */
export const PAGE_MARGIN = 0.09;
/** The thickness each leaf adds to its stack, so pages never flicker through each other. */
export const LEAF_GAP = 0.0012;
/** How long one page turn takes, in seconds. */
export const TURN_SECONDS = 1.1;
/** A turn finishing a drag still takes at least this long, so the page never snaps. */
export const MIN_TURN_SECONDS = 0.35;
/** Pieces in a page strip: enough for a smooth curve. */
export const SEGMENTS = 28;
/** How far the outer edge leads the spine (radians) when a page is lifted. */
export const LIFT = 0.75;

/** The spring each piece of paper follows its target with (per second). */
const STIFFNESS = 15;
/** Toward the edge, the spring loosens by this share, so the edge lags most. */
const FLEX = 0.72;
/** Just under critical damping: a hint of give, no wobble. */
const DAMPING_RATIO = 0.82;

export function easeInOut(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

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
  if (duration <= 0) return to;
  return from + (to - from) * easeInOut(elapsed / duration);
}

/**
 * After a finger lets go, the page is already moving: it carries on with an ease-out (no
 * second slow start) to wherever it lands.
 */
export function releaseProgress(from: number, to: number, elapsed: number, duration: number) {
  if (duration <= 0) return to;
  const t = Math.min(Math.max(elapsed / duration, 0), 1);
  return from + (to - from) * (1 - (1 - t) ** 3);
}

/** How long a turn over `distance` (0..1 of a full turn) takes. */
export function turnDuration(distance: number): number {
  return Math.max(TURN_SECONDS * Math.abs(distance), MIN_TURN_SECONDS);
}

/**
 * How far the edge leads (positive in the direction of travel) during an animated turn,
 * at `phase` 0..1 of it: lifted first, then trailing behind as the page comes down.
 */
export function turnLift(phase: number, direction: 1 | -1): number {
  const p = Math.min(Math.max(phase, 0), 1);
  return direction * LIFT * Math.sin(2 * Math.PI * p);
}

/** While a finger holds the page by its edge, the edge leads, most when the page stands up. */
export function dragLift(spineAngle: number, direction: 1 | -1): number {
  return direction * LIFT * Math.sin(spineAngle);
}

export interface Paper {
  angles: Float64Array;
  velocities: Float64Array;
}

/** A page lying flat at `angle` (0 or π). */
export function createPaper(angle: number): Paper {
  return { angles: new Float64Array(SEGMENTS).fill(angle), velocities: new Float64Array(SEGMENTS) };
}

/** Where each piece is heading: the spine's angle, plus the lift, growing toward the edge. */
export function paperTargets(spineAngle: number, lift: number, out: Float64Array): Float64Array {
  for (let j = 0; j < SEGMENTS; j++) {
    const u = (j + 0.5) / SEGMENTS;
    out[j] = Math.min(Math.max(spineAngle + lift * u ** 1.5, 0), Math.PI);
  }
  return out;
}

/**
 * Moves every piece along its spring for `dt` seconds. Pieces stop at 0 and π (the page
 * lands on the stack rather than passing through it). Returns true once the page has
 * come to rest on its targets.
 */
export function stepPaper(paper: Paper, targets: Float64Array, dt: number): boolean {
  const steps = Math.max(1, Math.ceil(Math.min(dt, 0.1) / (1 / 120)));
  const h = Math.min(dt, 0.1) / steps;
  let settled = true;
  for (let j = 0; j < SEGMENTS; j++) {
    const u = (j + 0.5) / SEGMENTS;
    const omega = STIFFNESS * (1 - FLEX * u);
    let a = paper.angles[j]!;
    let v = paper.velocities[j]!;
    const target = targets[j]!;
    for (let s = 0; s < steps; s++) {
      v += (omega * omega * (target - a) - 2 * DAMPING_RATIO * omega * v) * h;
      a += v * h;
      if (a < 0 || a > Math.PI) {
        a = Math.min(Math.max(a, 0), Math.PI);
        v = 0;
      }
    }
    if (Math.abs(target - a) < 1e-4 && Math.abs(v) < 1e-3) {
      a = target;
      v = 0;
    } else {
      settled = false;
    }
    paper.angles[j] = a;
    paper.velocities[j] = v;
  }
  return settled;
}

/** Puts a page's pieces in place for instant changes (reduced motion). */
export function settlePaper(paper: Paper, targets: Float64Array): void {
  paper.angles.set(targets);
  paper.velocities.fill(0);
}

/**
 * The page's shape: the (x, z) of each of the SEGMENTS + 1 columns of vertices, from the
 * spine outward, laying each piece end to end at its angle. Each piece keeps its length,
 * so the paper never stretches.
 */
export function layOutPaper(
  angles: Float64Array,
  width: number,
  xs: Float64Array,
  zs: Float64Array,
): void {
  const piece = width / SEGMENTS;
  xs[0] = 0;
  zs[0] = 0;
  for (let j = 0; j < SEGMENTS; j++) {
    xs[j + 1] = xs[j]! + piece * Math.cos(angles[j]!);
    zs[j + 1] = zs[j]! + piece * Math.sin(angles[j]!);
  }
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

// --- Opening the book ---

/** The closed book rests this long before the cover opens (seconds). */
export const OPEN_DELAY = 0.45;
/** How long the cover takes to swing open (seconds). */
export const OPEN_SECONDS = 1.7;

/** How open the cover is (0 closed, 1 open), `elapsed` seconds after the book appeared. */
export function openProgress(elapsed: number): number {
  return easeInOut((elapsed - OPEN_DELAY) / OPEN_SECONDS);
}

// --- Input ---

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

/**
 * A page held by a finger (or the mouse): which leaf, and how far over it is (0 = flat on
 * the right, 1 = flat on the left). Forward drags lift the open right-hand page; backward
 * drags lift the last turned page back.
 */
export interface DragTurn {
  leaf: number;
  direction: 1 | -1;
  progress: number;
}

/** Sideways movement (px) before a press becomes a page drag rather than a click. */
export const DRAG_START = 8;

/** The page follows the finger: moving `span` pixels carries it all the way over. */
export function dragProgress(dx: number, span: number, direction: 1 | -1): number {
  const moved = Math.min(Math.max((-direction * dx) / span, 0), 1);
  return direction === 1 ? moved : 1 - moved;
}

/** A flick faster than this (px per ms) turns the page however far it got. */
export const FLICK_SPEED = 0.45;

/**
 * Let go: does the page carry on over, or fall back? Over a third of the way, or flicked
 * in the direction of the turn, it goes over.
 */
export function releaseTurns(drag: DragTurn, velocity: number): boolean {
  const travelled = drag.direction === 1 ? drag.progress : 1 - drag.progress;
  const flicked = -drag.direction * velocity > FLICK_SPEED;
  return travelled > 1 / 3 || flicked;
}

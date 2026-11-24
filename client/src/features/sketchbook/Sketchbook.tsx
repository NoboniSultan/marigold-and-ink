/**
 * The 3D sketchbook: a book on a chalkboard that opens as Home loads, then one artwork per
 * spread (see sketchbook.ts for the layout, the paper model, and the arithmetic).
 *
 * - Covers: both are hinged at the spine. The front one opens as Home loads (once the
 *   cover is drawn, the parent opens the book) and shuts again with one more swipe back
 *   from the first spread; the back one shuts after the last page turns. The camera
 *   follows the closed book, so it's always centred.
 * - Leaves: each is a strip of paper. Its spine end is driven by a turn (eased) or by a
 *   finger (a drag); the rest of the strip follows on springs, so the page moves like
 *   paper. Resting pages aren't recomputed.
 * - Only leaves near the open spread get real page textures, so the GPU holds a handful of
 *   pages however big the collection grows.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  Color,
  FrontSide,
  MathUtils,
  PlaneGeometry,
  type CanvasTexture,
  type Group,
  type Mesh,
  type PerspectiveCamera,
} from 'three';
import type { Artwork } from '@shared/types/artwork.ts';
import {
  BACK_COVER_DELAY,
  LAST_LEAF_DELAY,
  LEAF_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SEGMENTS,
  backCoverTarget,
  createPaper,
  dragLift,
  frontCoverTarget,
  hingeProgress,
  isNearSpread,
  layOutPaper,
  leafTarget,
  paperTargets,
  releaseProgress,
  settlePaper,
  stackHeight,
  stepPaper,
  turnDuration,
  turnLift,
  turnProgress,
  type DragTurn,
  type Paper,
} from './sketchbook.ts';
import {
  artworkTexture,
  blankTexture,
  captionTexture,
  coverTexture,
  readPalette,
  shadowTexture,
} from './pageTextures.ts';

/** The camera looks down at the book from this angle off vertical, like a reader at a desk. */
const VIEW_TILT = 0.3;
/** How far the cover boards reach past the pages. */
const BOARD_MARGIN = 0.07;
const BOARD_WIDTH = PAGE_WIDTH + BOARD_MARGIN;
const BOARD_HEIGHT = PAGE_HEIGHT + BOARD_MARGIN * 2;
const BOARD_THICKNESS = 0.03;
/** Where the open boards lie: just under the pages. */
const BOARD_Z = -0.025;
/** A drag longer than this (in pixels) is a page turn, not a click. */
const CLICK_SLOP = 6;
/** If the cover's lettering is slow to load, open anyway after this long (seconds). */
const COVER_WAIT = 4;

/** Creates a texture when `make` is given, and disposes it when it's no longer needed. */
function useAsyncTexture(make: (() => Promise<CanvasTexture>) | null): CanvasTexture | null {
  const [texture, setTexture] = useState<CanvasTexture | null>(null);
  useEffect(() => {
    if (!make) return;
    let current = true;
    let made: CanvasTexture | null = null;
    make()
      .then((result) => {
        if (current) {
          made = result;
          setTexture(result);
        } else {
          result.dispose();
        }
      })
      .catch(() => {
        // A missing image leaves the page blank rather than breaking the book.
      });
    return () => {
      current = false;
      made?.dispose();
      setTexture(null);
    };
  }, [make]);
  return texture;
}

/** One leaf's moving parts, kept between frames. */
interface LeafMotion {
  paper: Paper;
  targets: Float64Array;
  xs: Float64Array;
  zs: Float64Array;
  /** Where the spine is (0 = on the right, 1 = on the left). */
  progress: number;
  /** The current turn: eased toward `to`, or carried on from a finger. */
  turn: { from: number; to: number; start: number; duration: number; released: boolean };
  held: boolean;
  /** The resting shape has been drawn, so nothing needs recomputing until it moves. */
  drawnAtRest: boolean;
}

function startMotion(target: number): LeafMotion {
  return {
    paper: createPaper(target * Math.PI),
    targets: new Float64Array(SEGMENTS),
    xs: new Float64Array(SEGMENTS + 1),
    zs: new Float64Array(SEGMENTS + 1),
    progress: target,
    turn: { from: target, to: target, start: 0, duration: 0, released: false },
    held: false,
    drawnAtRest: false,
  };
}

interface LeafProps {
  index: number;
  count: number;
  artwork: Artwork;
  /** The artwork whose caption is on this leaf's back; none for the last leaf. */
  next: Artwork | undefined;
  spread: number;
  instant: boolean;
  dragTurn: RefObject<DragTurn | null>;
  blanks: { front: CanvasTexture; back: CanvasTexture };
  onOpen: (artwork: Artwork) => void;
}

function Leaf(props: LeafProps) {
  const { index, count, artwork, next, spread, instant, dragTurn, blanks, onOpen } = props;
  // A page-sized strip, moved so x runs from the spine (0) to the outer edge (PAGE_WIDTH).
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(PAGE_WIDTH, PAGE_HEIGHT, SEGMENTS, 1);
    plane.translate(PAGE_WIDTH / 2, 0, 0);
    const vertices = plane.attributes.position!.count;
    plane.setAttribute('color', new BufferAttribute(new Float32Array(vertices * 3).fill(1), 3));
    return plane;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const target = leafTarget(index, spread);
  const motion = useRef<LeafMotion | null>(null);
  // The geometry is reshaped every frame it moves, through the mesh (three.js objects are
  // mutable by design; React only created it).
  const frontMesh = useRef<Mesh>(null);

  useFrame(({ clock }, delta) => {
    const geometry = frontMesh.current?.geometry;
    if (!geometry) return;
    const m = (motion.current ??= startMotion(target));
    const now = clock.elapsedTime;
    const drag = dragTurn.current;
    const held = drag?.leaf === index ? drag : null;

    let lift = 0;
    if (held) {
      // The page follows the finger, its edge leading.
      m.progress = held.progress;
      lift = dragLift(m.progress * Math.PI, held.direction);
      m.held = true;
    } else {
      if (m.held || target !== m.turn.to) {
        // A new turn, or a finger let go: start from wherever the page is now. The last
        // page waits under a shut back cover until the cover has lifted off it.
        const underBackCover = index === count - 1 && target === 0 && m.turn.to === 1;
        m.turn = {
          from: m.progress,
          to: target,
          start: now + (underBackCover && !m.held ? LAST_LEAF_DELAY : 0),
          duration: instant ? 0 : turnDuration(target - m.progress),
          released: m.held,
        };
        m.held = false;
      }
      const { from, to, start, duration, released } = m.turn;
      const elapsed = now - start;
      m.progress = released
        ? releaseProgress(from, to, elapsed, duration)
        : turnProgress(from, to, elapsed, duration);
      // An animated turn lifts the edge first and lets it trail late; a released page
      // already has its shape, so the springs carry it.
      if (!released && from !== to && duration > 0) {
        lift = turnLift(elapsed / duration, to > from ? 1 : -1);
      }
    }

    paperTargets(m.progress * Math.PI, lift, m.targets);
    let settled = true;
    if (instant) settlePaper(m.paper, m.targets);
    else settled = stepPaper(m.paper, m.targets, delta);
    if (settled && !held && m.drawnAtRest) return; // resting: nothing to recompute
    m.drawnAtRest = settled && !held;

    layOutPaper(m.paper.angles, PAGE_WIDTH, m.xs, m.zs);
    const height = stackHeight(index, count, m.progress);
    const position = geometry.attributes.position!;
    for (let i = 0; i < position.count; i++) {
      const column = i % (SEGMENTS + 1);
      position.setXYZ(i, m.xs[column]!, position.getY(i), m.zs[column]! + height);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    // Shade by how much each part of the page faces the reader: a curling page darkens
    // as it stands up, which is what makes the turn read as paper. Flat pages stay at 1.
    const normal = geometry.attributes.normal!;
    const color = geometry.attributes.color!;
    for (let i = 0; i < color.count; i++) {
      const shade = 0.68 + 0.32 * Math.abs(normal.getZ(i));
      color.setXYZ(i, shade, shade, shade);
    }
    color.needsUpdate = true;
  });

  const near = isNearSpread(index, spread);
  const makeFront = useMemo(() => (near ? () => artworkTexture(artwork) : null), [near, artwork]);
  const makeBack = useMemo(
    () =>
      near && next ? () => captionTexture(next, { number: index + 2, total: count }, true) : null,
    [near, next, index, count],
  );
  const front = useAsyncTexture(makeFront);
  const back = useAsyncTexture(makeBack);

  // Only the open right-hand page can be clicked open.
  const isOpenPage = index === spread;
  const setCursor = (value: string) => {
    document.body.style.cursor = value;
  };

  return (
    <group>
      <mesh
        ref={frontMesh}
        geometry={geometry}
        onClick={(event: ThreeEvent<MouseEvent>) => {
          if (!isOpenPage || event.delta > CLICK_SLOP) return;
          event.stopPropagation();
          onOpen(artwork);
        }}
        onPointerOver={() => isOpenPage && setCursor('pointer')}
        onPointerOut={() => setCursor('')}
      >
        <meshBasicMaterial map={front ?? blanks.front} vertexColors side={FrontSide} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial map={back ?? blanks.back} vertexColors side={BackSide} />
      </mesh>
    </group>
  );
}

/** A cover's swing: 0 = lying on the right, 1 = over on the left. */
interface Hinge {
  value: number;
  from: number;
  to: number;
  start: number;
}

/** Eases a hinge toward its target; a new target starts from wherever it is now. */
function moveHinge(
  hinge: Hinge,
  target: number,
  now: number,
  { delay = 0, instant = false } = {},
): void {
  if (target !== hinge.to) {
    hinge.from = hinge.value;
    hinge.to = target;
    hinge.start = now + delay;
  }
  hinge.value = instant ? hinge.to : hingeProgress(hinge.from, hinge.to, now - hinge.start);
}

/** A cover board: Ink, with lighter edges so it reads against the dark chalkboard. */
function Board({ color, edge }: { color: Color; edge: Color }) {
  return (
    <mesh position={[BOARD_WIDTH / 2, 0, 0]}>
      <boxGeometry args={[BOARD_WIDTH - 0.006, BOARD_HEIGHT, BOARD_THICKNESS]} />
      {/* Box faces: +x, −x, +y, −y (the edges), then +z, −z (the boards' faces). */}
      {[0, 1, 2, 3].map((face) => (
        <meshBasicMaterial key={face} attach={`material-${face}`} color={edge} />
      ))}
      <meshBasicMaterial attach="material-4" color={color} />
      <meshBasicMaterial attach="material-5" color={color} />
    </mesh>
  );
}

interface CoverProps {
  hinge: RefObject<Hinge | null>;
  /** The hinge's height lying on the right (0) and turned over to the left (1). */
  heights: [number, number];
  color: Color;
  edge: Color;
  /** Faces carried with the board (the front's lettering and inside page). */
  children?: ReactNode;
}

/** A cover board hinged at the spine; rotating by −angle lifts its free edge toward the reader. */
function Cover({ hinge, heights, color, edge, children }: CoverProps) {
  const group = useRef<Group>(null);
  useFrame(() => {
    const swing = hinge.current?.value;
    if (!group.current || swing === undefined) return;
    group.current.rotation.y = -Math.PI * swing;
    group.current.position.z = MathUtils.lerp(heights[0], heights[1], swing);
  });
  return (
    <group ref={group}>
      <Board color={color} edge={edge} />
      {children}
    </group>
  );
}

/** Where the book's middle is: the closed book sits right of the spine (front) or left (back). */
function bookCentre(front: number, back: number, portrait: boolean): number {
  if (portrait) {
    // Phones frame the right-hand page, or the shut book wherever it lies.
    return MathUtils.lerp(PAGE_WIDTH / 2, -BOARD_WIDTH / 2, back);
  }
  return (BOARD_WIDTH / 2) * (1 - front) - (BOARD_WIDTH / 2) * back;
}

/**
 * Keeps the camera at the reading angle, with the book filling the view, and follows the
 * book as it opens and shuts. On a portrait screen (a phone) it frames the right-hand page,
 * the artwork; the caption is in the controls below.
 */
function FitCamera({
  front,
  back,
}: {
  front: RefObject<Hinge | null>;
  back: RefObject<Hinge | null>;
}) {
  useFrame(({ camera, size }) => {
    const perspective = camera as PerspectiveCamera;
    const portrait = size.width < size.height;
    const centre = bookCentre(front.current?.value ?? 0, back.current?.value ?? 0, portrait);
    const viewWidth = portrait ? PAGE_WIDTH + BOARD_MARGIN * 2 : BOARD_WIDTH * 2;
    const viewHeight = BOARD_HEIGHT;
    const tan = Math.tan(MathUtils.degToRad(perspective.fov / 2));
    // The distance at which the book fills the view, with room around it.
    const distance =
      (portrait ? 1.15 : 1.22) *
      Math.max(viewHeight / 2 / tan, viewWidth / 2 / (tan * (size.width / size.height)));
    camera.position.set(centre, -distance * Math.sin(VIEW_TILT), distance * Math.cos(VIEW_TILT));
    camera.lookAt(centre, 0, 0);
  });
  return null;
}

interface SketchbookProps {
  artworks: Artwork[];
  /** From CLOSED_FRONT (−1) through the artworks to `artworks.length` (shut at the back). */
  spread: number;
  /** Reduced motion: covers and pages change without moving. */
  instant: boolean;
  /** The page a finger is holding, if any (set by SketchbookCanvas). */
  dragTurn: RefObject<DragTurn | null>;
  onOpen: (artwork: Artwork) => void;
  /** Called once the front cover is drawn (or after a wait), so the parent can open the book. */
  onCoverReady: () => void;
}

export function Sketchbook(props: SketchbookProps) {
  const { artworks, spread, instant, dragTurn, onOpen, onCoverReady } = props;
  const count = artworks.length;
  const blanks = useMemo(
    () => ({
      front: blankTexture('left', false),
      back: blankTexture('right', true),
      insideCover: blankTexture('right', false),
    }),
    [],
  );
  const shadow = useMemo(() => shadowTexture(), []);
  const colors = useMemo(() => {
    const palette = readPalette();
    const ink = new Color(palette.ink);
    // The boards' edges: Ink lightened, like the worn edge of a cloth cover.
    return { ink, edge: ink.clone().lerp(new Color(palette.paper), 0.28) };
  }, []);
  useEffect(
    () => () => {
      blanks.front.dispose();
      blanks.back.dispose();
      blanks.insideCover.dispose();
      shadow.dispose();
      document.body.style.cursor = '';
    },
    [blanks, shadow],
  );

  const makeCover = useMemo(() => () => coverTexture(BOARD_WIDTH / BOARD_HEIGHT), []);
  const outside = useAsyncTexture(makeCover);
  // The inside cover: the first artwork's caption, opposite the first artwork.
  const first = artworks[0];
  const makeInsideCover = useMemo(
    () => (first ? () => captionTexture(first, { number: 1, total: count }, false) : null),
    [first, count],
  );
  const insideCover = useAsyncTexture(makeInsideCover);

  // The covers' swings, read every frame by the covers, the camera, and the shadow.
  const front = useRef<Hinge | null>(null);
  const back = useRef<Hinge | null>(null);
  const shadowMesh = useRef<Mesh>(null);
  const ready = useRef<{ firstFrame: number | null; told: boolean }>({
    firstFrame: null,
    told: false,
  });

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const frontTarget = frontCoverTarget(spread);
    const backTarget = backCoverTarget(spread, count);
    front.current ??= { value: frontTarget, from: frontTarget, to: frontTarget, start: 0 };
    back.current ??= { value: backTarget, from: backTarget, to: backTarget, start: 0 };
    moveHinge(front.current, frontTarget, now, { instant });
    // Shutting at the back, the last page lands first; opening, the cover goes straight away.
    moveHinge(back.current, backTarget, now, {
      instant,
      delay: backTarget === 1 ? BACK_COVER_DELAY : 0,
    });

    // Let the parent open the book once the closed cover can be seen as a cover.
    const start = ready.current;
    start.firstFrame ??= now;
    if (!start.told && (outside || now - start.firstFrame > COVER_WAIT)) {
      start.told = true;
      onCoverReady();
    }

    const mesh = shadowMesh.current;
    if (mesh) {
      const f = front.current.value;
      const b = back.current.value;
      mesh.position.x = bookCentre(f, b, false);
      mesh.scale.x = 1 - 0.48 * Math.max(1 - f, b);
    }
  });

  // Shut, a cover's hinge sits just above the stack of pages.
  const shutHeight = (count + 1) * LEAF_GAP + BOARD_THICKNESS / 2 + 0.004;
  const face = BOARD_THICKNESS / 2 + 0.002;

  return (
    <>
      {/* The shadow the book casts. */}
      <mesh ref={shadowMesh} position={[0, -0.04, -0.06]}>
        <planeGeometry args={[BOARD_WIDTH * 2 * 1.3, BOARD_HEIGHT * 1.32]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>

      {/* Back cover: under the pages on the right; shut over them once every page is turned. */}
      <Cover hinge={back} heights={[BOARD_Z, shutHeight]} color={colors.ink} edge={colors.edge} />

      {/* Front cover: shut over the pages, lettering up; open, under the left-hand pages. */}
      <Cover hinge={front} heights={[shutHeight, BOARD_Z]} color={colors.ink} edge={colors.edge}>
        {outside && (
          <mesh position={[BOARD_WIDTH / 2, 0, face]}>
            <planeGeometry args={[BOARD_WIDTH - 0.006, BOARD_HEIGHT]} />
            <meshBasicMaterial map={outside} />
          </mesh>
        )}
        {/* Faces down while shut; once the cover turns over, it's the left-hand page. */}
        <mesh position={[PAGE_WIDTH / 2, 0, -face]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
          <meshBasicMaterial map={insideCover ?? blanks.insideCover} />
        </mesh>
      </Cover>

      {artworks.map((artwork, index) => (
        <Leaf
          key={artwork.id}
          index={index}
          count={count}
          artwork={artwork}
          next={artworks[index + 1]}
          spread={spread}
          instant={instant}
          dragTurn={dragTurn}
          blanks={blanks}
          onOpen={onOpen}
        />
      ))}

      <FitCamera front={front} back={back} />
    </>
  );
}

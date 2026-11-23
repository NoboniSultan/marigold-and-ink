/**
 * The 3D sketchbook: a book on a desk that opens when Explore does, then one artwork per
 * spread (see sketchbook.ts for the layout, the paper model, and the arithmetic).
 *
 * - Opening: the closed book rests a moment, then the front cover swings over the spine
 *   while the book slides to the middle of the view.
 * - Leaves: each is a strip of paper. Its spine end is driven by a turn (eased) or by a
 *   finger (a drag); the rest of the strip follows on springs, so the page moves like
 *   paper. Resting pages aren't recomputed.
 * - Only leaves near the open spread get real page textures, so the GPU holds a handful of
 *   pages however big the collection grows.
 */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
  LEAF_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  SEGMENTS,
  createPaper,
  dragLift,
  isNearSpread,
  layOutPaper,
  leafTarget,
  openProgress,
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
  /** False while the cover is still opening. */
  interactive: boolean;
  instant: boolean;
  dragTurn: RefObject<DragTurn | null>;
  blanks: { front: CanvasTexture; back: CanvasTexture };
  onOpen: (artwork: Artwork) => void;
}

function Leaf(props: LeafProps) {
  const { index, count, artwork, next, spread, interactive, instant, dragTurn, blanks, onOpen } =
    props;
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
    const held = interactive && drag?.leaf === index ? drag : null;

    let lift = 0;
    if (held) {
      // The page follows the finger, its edge leading.
      m.progress = held.progress;
      lift = dragLift(m.progress * Math.PI, held.direction);
      m.held = true;
    } else {
      if (m.held || target !== m.turn.to) {
        // A new turn, or a finger let go: start from wherever the page is now.
        m.turn = {
          from: m.progress,
          to: target,
          start: now,
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
  const isOpenPage = interactive && index === spread;
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

interface CoverProps {
  open: RefObject<number>;
  /** Height of the closed cover's hinge: just above the stack of pages. */
  closedZ: number;
  color: Color;
  outside: CanvasTexture | null;
  inside: CanvasTexture;
}

/**
 * The front cover, hinged at the spine. Closed, it lies over the pages, lettering up;
 * open, it lies flat on the left, carrying the inside-cover page (the first caption).
 */
function Cover({ open, closedZ, color, outside, inside }: CoverProps) {
  const hinge = useRef<Group>(null);
  useFrame(() => {
    const group = hinge.current;
    if (!group) return;
    // Rotating by −angle about the spine lifts the free edge toward the reader.
    group.rotation.y = -Math.PI * open.current;
    group.position.z = MathUtils.lerp(closedZ, BOARD_Z, open.current);
  });
  const face = BOARD_THICKNESS / 2 + 0.002;
  return (
    <group ref={hinge}>
      <mesh position={[BOARD_WIDTH / 2, 0, 0]}>
        <boxGeometry args={[BOARD_WIDTH - 0.006, BOARD_HEIGHT, BOARD_THICKNESS]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {outside && (
        <mesh position={[BOARD_WIDTH / 2, 0, face]}>
          <planeGeometry args={[BOARD_WIDTH - 0.006, BOARD_HEIGHT]} />
          <meshBasicMaterial map={outside} />
        </mesh>
      )}
      {/* Faces down while closed; once the cover turns over, it's the left-hand page. */}
      <mesh position={[PAGE_WIDTH / 2, 0, -face]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial map={inside} />
      </mesh>
    </group>
  );
}

/**
 * Keeps the camera at the reading angle, with the book filling the view. While the book
 * is closed it centres on the closed book, then glides to the middle as it opens. On a
 * portrait screen (a phone) it always frames the right-hand page, the artwork; the caption
 * is in the controls below.
 */
function FitCamera({ open }: { open: RefObject<number> }) {
  useFrame(({ camera, size }) => {
    const perspective = camera as PerspectiveCamera;
    const portrait = size.width < size.height;
    const centre = portrait ? PAGE_WIDTH / 2 : MathUtils.lerp(BOARD_WIDTH / 2, 0, open.current);
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
  spread: number;
  /** Reduced motion: the book starts open, and pages change without turning. */
  instant: boolean;
  /** The page a finger is holding, if any (set by ExploreCanvas). */
  dragTurn: RefObject<DragTurn | null>;
  onOpen: (artwork: Artwork) => void;
}

export function Sketchbook({ artworks, spread, instant, dragTurn, onOpen }: SketchbookProps) {
  const blanks = useMemo(
    () => ({
      front: blankTexture('left', false),
      back: blankTexture('right', true),
      insideCover: blankTexture('right', false),
    }),
    [],
  );
  const shadow = useMemo(() => shadowTexture(), []);
  const coverColor = useMemo(() => new Color(readPalette().ink), []);
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
    () =>
      first ? () => captionTexture(first, { number: 1, total: artworks.length }, false) : null,
    [first, artworks.length],
  );
  const insideCover = useAsyncTexture(makeInsideCover);

  // Opening: 0 = closed, 1 = open. Read every frame by the cover, camera and shadow.
  const open = useRef(instant ? 1 : 0);
  const [opened, setOpened] = useState(instant);
  const clockStart = useRef<{ shown: number | null; opening: number | null }>({
    shown: null,
    opening: null,
  });
  useFrame(({ clock }) => {
    if (opened) return;
    if (instant) {
      open.current = 1;
      setOpened(true);
      return;
    }
    const now = clock.elapsedTime;
    const start = clockStart.current;
    start.shown ??= now;
    // Wait for the cover's lettering, so the closed book is seen as a book.
    if (!outside && now - start.shown < COVER_WAIT) return;
    start.opening ??= now;
    open.current = openProgress(now - start.opening);
    if (open.current >= 1) setOpened(true);
  });

  const shadowMesh = useRef<Mesh>(null);
  useFrame(() => {
    const mesh = shadowMesh.current;
    if (!mesh) return;
    mesh.position.x = MathUtils.lerp(BOARD_WIDTH / 2, 0, open.current);
    mesh.scale.x = MathUtils.lerp(0.52, 1, open.current);
  });

  // Until the cover is open, the book stays on its first spread.
  const shownSpread = opened ? spread : 0;

  return (
    <>
      {/* The shadow the book casts on the desk. */}
      <mesh ref={shadowMesh} position={[0, -0.04, -0.06]}>
        <planeGeometry args={[BOARD_WIDTH * 2 * 1.3, BOARD_HEIGHT * 1.32]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>

      {/* The back cover, under the pages on the right. */}
      <mesh position={[BOARD_WIDTH / 2, 0, BOARD_Z]}>
        <boxGeometry args={[BOARD_WIDTH - 0.006, BOARD_HEIGHT, BOARD_THICKNESS]} />
        <meshBasicMaterial color={coverColor} />
      </mesh>

      <Cover
        open={open}
        closedZ={(artworks.length + 1) * LEAF_GAP + BOARD_THICKNESS / 2 + 0.004}
        color={coverColor}
        outside={outside}
        inside={insideCover ?? blanks.insideCover}
      />

      {artworks.map((artwork, index) => (
        <Leaf
          key={artwork.id}
          index={index}
          count={artworks.length}
          artwork={artwork}
          next={artworks[index + 1]}
          spread={shownSpread}
          interactive={opened}
          instant={instant}
          dragTurn={dragTurn}
          blanks={blanks}
          onOpen={onOpen}
        />
      ))}

      <FitCamera open={open} />
    </>
  );
}

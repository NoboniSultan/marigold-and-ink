/**
 * The 3D sketchbook: an open book on a desk, one artwork per spread (see sketchbook.ts
 * for the layout and the arithmetic).
 *
 * Each leaf is a strip of paper bent along its width. When the open spread changes, the
 * leaves that need to move turn over the spine with an ease-in-out, curling as they go,
 * and settle flat. Only leaves near the open spread get real page textures, so the GPU
 * holds a handful of pages however big the collection grows.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import {
  BackSide,
  BufferAttribute,
  Color,
  FrontSide,
  MathUtils,
  PlaneGeometry,
  type CanvasTexture,
  type Mesh,
  type PerspectiveCamera,
} from 'three';
import type { Artwork } from '@shared/types/artwork.ts';
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  TURN_SECONDS,
  bendPoint,
  isNearSpread,
  leafShape,
  leafTarget,
  stackHeight,
  turnProgress,
} from './sketchbook.ts';
import {
  artworkTexture,
  blankTexture,
  captionTexture,
  readPalette,
  shadowTexture,
} from './pageTextures.ts';

/** Columns of vertices across a page: enough for a smooth curl. */
const SEGMENTS = 28;
/** The camera looks down at the book from this angle off vertical, like a reader at a desk. */
const VIEW_TILT = 0.45;
/** How far the cover boards reach past the pages. */
const BOARD_MARGIN = 0.07;
/** A drag longer than this (in pixels) is a page turn, not a click. */
const CLICK_SLOP = 6;

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

interface LeafProps {
  index: number;
  count: number;
  artwork: Artwork;
  /** The artwork whose caption is on this leaf's back; none for the last leaf. */
  next: Artwork | undefined;
  spread: number;
  instant: boolean;
  blanks: { front: CanvasTexture; back: CanvasTexture };
  onOpen: (artwork: Artwork) => void;
}

function Leaf({ index, count, artwork, next, spread, instant, blanks, onOpen }: LeafProps) {
  // A page-sized strip, moved so x runs from the spine (0) to the outer edge (PAGE_WIDTH).
  const geometry = useMemo(() => {
    const plane = new PlaneGeometry(PAGE_WIDTH, PAGE_HEIGHT, SEGMENTS, 1);
    plane.translate(PAGE_WIDTH / 2, 0, 0);
    const vertices = plane.attributes.position!.count;
    plane.setAttribute('color', new BufferAttribute(new Float32Array(vertices * 3).fill(1), 3));
    return plane;
  }, []);
  // Each vertex's distance from the spine, kept from the flat page.
  const along = useMemo(
    () =>
      Float32Array.from({ length: geometry.attributes.position!.count }, (_, i) =>
        geometry.attributes.position!.getX(i),
      ),
    [geometry],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const target = leafTarget(index, spread);
  const turn = useRef<{ from: number; to: number; start: number; progress: number; drawn: number }>(
    { from: target, to: target, start: 0, progress: target, drawn: -1 },
  );
  // The geometry is reshaped every frame of a turn, through the mesh (three.js objects
  // are mutable by design; React only created it).
  const frontMesh = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    const state = turn.current;
    const now = clock.elapsedTime;
    if (target !== state.to) {
      // Start from wherever the page is now, so reversing mid-turn is smooth.
      state.from = state.progress;
      state.to = target;
      state.start = now;
    }
    const duration = instant ? 0 : TURN_SECONDS * Math.abs(state.to - state.from);
    state.progress = turnProgress(state.from, state.to, now - state.start, duration);
    const geometry = frontMesh.current?.geometry;
    if (!geometry || state.progress === state.drawn) return; // resting: nothing to recompute
    state.drawn = state.progress;

    const { angle, curl } = leafShape(state.progress);
    const lift = stackHeight(index, count, state.progress);
    const position = geometry.attributes.position!;
    for (let i = 0; i < position.count; i++) {
      const [x, z] = bendPoint(along[i]!, PAGE_WIDTH, angle, curl);
      position.setXYZ(i, x, position.getY(i), z + lift);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    // Shade by how much each part of the page faces the reader: a curling page darkens
    // as it stands up, which is what makes the turn read as paper. Flat pages stay at 1.
    const normal = geometry.attributes.normal!;
    const color = geometry.attributes.color!;
    for (let i = 0; i < color.count; i++) {
      color.setX(i, 0.7 + 0.3 * Math.abs(normal.getZ(i)));
      color.setY(i, color.getX(i));
      color.setZ(i, color.getX(i));
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

/**
 * Places the camera at the reading angle so the open book fits the canvas. On a portrait
 * screen (a phone) the whole spread would be tiny, so it frames the right-hand page, the
 * artwork, instead; the caption is in the controls below.
 */
function FitCamera() {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const { width, height } = useThree((state) => state.size);
  useEffect(() => {
    const portrait = width < height;
    const centre = portrait ? PAGE_WIDTH / 2 : 0;
    const viewWidth = portrait ? PAGE_WIDTH + BOARD_MARGIN * 2 : (PAGE_WIDTH + BOARD_MARGIN) * 2;
    const viewHeight = PAGE_HEIGHT + BOARD_MARGIN * 2;
    const tan = Math.tan(MathUtils.degToRad(camera.fov / 2));
    // The distance at which the book fills the view, with room around it. The near
    // (bottom) edge looms larger at an angle, hence the generous margin.
    const distance =
      (portrait ? 1.18 : 1.3) *
      Math.max(viewHeight / 2 / tan, viewWidth / 2 / (tan * (width / height)));
    camera.position.set(centre, -distance * Math.sin(VIEW_TILT), distance * Math.cos(VIEW_TILT));
    camera.lookAt(centre, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, width, height]);
  return null;
}

interface SketchbookProps {
  artworks: Artwork[];
  spread: number;
  /** Reduced motion: pages change without turning. */
  instant: boolean;
  onOpen: (artwork: Artwork) => void;
}

export function Sketchbook({ artworks, spread, instant, onOpen }: SketchbookProps) {
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

  // The inside cover: the first artwork's caption, opposite the first artwork.
  const first = artworks[0];
  const makeInsideCover = useMemo(
    () =>
      first ? () => captionTexture(first, { number: 1, total: artworks.length }, false) : null,
    [first, artworks.length],
  );
  const insideCover = useAsyncTexture(makeInsideCover);

  const boardWidth = PAGE_WIDTH + BOARD_MARGIN;
  const boardHeight = PAGE_HEIGHT + BOARD_MARGIN * 2;

  return (
    <>
      {/* The shadow the book casts on the desk. */}
      <mesh position={[0, -0.04, -0.06]}>
        <planeGeometry args={[boardWidth * 2 * 1.3, boardHeight * 1.32]} />
        <meshBasicMaterial map={shadow} transparent depthWrite={false} />
      </mesh>

      {/* The covers, open flat: two boards meeting at the spine. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * boardWidth) / 2, 0, -0.025]}>
          <boxGeometry args={[boardWidth - 0.006, boardHeight, 0.03]} />
          <meshBasicMaterial color={coverColor} />
        </mesh>
      ))}

      {/* The inside cover's page, under the leaves that will be turned onto it. */}
      <mesh position={[-PAGE_WIDTH / 2, 0, 0]}>
        <planeGeometry args={[PAGE_WIDTH, PAGE_HEIGHT]} />
        <meshBasicMaterial map={insideCover ?? blanks.insideCover} />
      </mesh>

      {artworks.map((artwork, index) => (
        <Leaf
          key={artwork.id}
          index={index}
          count={artworks.length}
          artwork={artwork}
          next={artworks[index + 1]}
          spread={spread}
          instant={instant}
          blanks={blanks}
          onOpen={onOpen}
        />
      ))}

      <FitCamera />
    </>
  );
}

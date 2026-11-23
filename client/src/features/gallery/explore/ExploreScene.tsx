/**
 * The 3D scene: artworks on the inside of a cylinder, all facing the camera at its centre.
 * Scrolling, dragging, or the arrow keys set a target angle; every frame the cylinder eases
 * (lerps) toward it, so movement stays smooth however jerky the input is.
 */
import { Suspense, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { DepthOfField, EffectComposer } from '@react-three/postprocessing';
import { MathUtils, SRGBColorSpace, type Group, type Mesh, type MeshBasicMaterial } from 'three';
import type { Artwork } from '@shared/types/artwork.ts';
import { layoutSlots, mixTones, scatterFor } from './layout.ts';

export const RADIUS = 5;
const ROW_HEIGHT = 2.4;
/** Tallest a card may be. With the scatter, the highest card still clears the top of the view. */
const CARD_HEIGHT = 2.3;
/**
 * How wide a card may be, as a share of its slot. Over 1, so neighbours can overlap a
 * little, like pieces hung close together; each sits at its own depth (scatterFor).
 */
const SLOT_FILL = 1.08;
/** How quickly motion catches up with input: higher is snappier. */
const EASE_RATE = 6;

interface CardProps {
  artwork: Artwork;
  angle: number;
  y: number;
  /** Distance from the centre: around RADIUS, nearer or farther per card. */
  radius: number;
  /** A slight tilt around the viewing axis, in radians. */
  roll: number;
  /** The widest a card may be before it would touch its neighbours. */
  maxWidth: number;
  onOpen: (artwork: Artwork) => void;
}

function Card({ artwork, angle, y, radius, roll, maxWidth, onOpen }: CardProps) {
  const texture = useTexture(artwork.image.thumb.src, (loaded) => {
    loaded.colorSpace = SRGBColorSpace; // the WebP is sRGB; tell three.js so colors stay true
  });
  const tilt = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const pointer = useRef({ x: 0, y: 0 });

  const { width, height } = artwork.image.thumb;
  // Keep the artwork's whole image and proportions (never cropped); very wide pieces
  // shrink to fit their slot.
  const aspect = width / height;
  const cardHeight = Math.min(CARD_HEIGHT, maxWidth / aspect);
  const cardWidth = cardHeight * aspect;

  // Hover: scale up, brighten, and tilt toward the cursor, all eased per frame.
  useFrame((_, delta) => {
    const t = 1 - Math.exp(-delta * 10);
    if (mesh.current) {
      const scale = MathUtils.lerp(mesh.current.scale.x, hovered ? 1.08 : 1, t);
      mesh.current.scale.setScalar(scale);
    }
    if (material.current) {
      const brightness = MathUtils.lerp(material.current.color.r, hovered ? 1.15 : 0.92, t);
      material.current.color.setScalar(brightness);
    }
    if (tilt.current) {
      const targetX = hovered ? -pointer.current.y * 0.25 : 0;
      const targetY = hovered ? pointer.current.x * 0.25 : 0;
      tilt.current.rotation.x = MathUtils.lerp(tilt.current.rotation.x, targetX, t);
      tilt.current.rotation.y = MathUtils.lerp(tilt.current.rotation.y, targetY, t);
    }
  });

  function onPointerMove(event: ThreeEvent<PointerEvent>) {
    // uv runs 0..1 across the card; recentre to -0.5..0.5.
    if (event.uv) pointer.current = { x: event.uv.x - 0.5, y: event.uv.y - 0.5 };
  }

  // Place on the cylinder wall, rotated so the card's front faces the centre.
  const x = Math.sin(angle) * radius;
  const z = -Math.cos(angle) * radius;

  return (
    <group position={[x, y, z]} rotation={[0, -angle, 0]}>
      <group ref={tilt} rotation-z={roll}>
        <mesh
          ref={mesh}
          onPointerOver={(event) => {
            event.stopPropagation();
            setHovered(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = '';
          }}
          onPointerMove={onPointerMove}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(artwork);
          }}
        >
          <planeGeometry args={[cardWidth, cardHeight]} />
          <meshBasicMaterial ref={material} map={texture} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

interface SceneProps {
  artworks: Artwork[];
  onOpen: (artwork: Artwork) => void;
  /** Target rotation in radians, set by scroll, drag, and keys in ExploreCanvas. */
  targetRotation: RefObject<number>;
}

export function ExploreScene({ artworks, onOpen, targetRotation }: SceneProps) {
  const cylinder = useRef<Group>(null);

  useFrame((_, delta) => {
    if (!cylinder.current) return;
    // Frame-rate independent easing: the same feel at 60 Hz and 120 Hz.
    const t = 1 - Math.exp(-delta * EASE_RATE);
    cylinder.current.rotation.y = MathUtils.lerp(
      cylinder.current.rotation.y,
      targetRotation.current,
      t,
    );
  });

  // Black-and-white and coloured pieces mixed, then two staggered rows around the full
  // circle, each card straying a little from its slot (see layout.ts).
  const ordered = useMemo(() => mixTones(artworks, (a) => a.image.monochrome), [artworks]);
  const { perRow, slots } = layoutSlots(ordered.length);
  const step = (Math.PI * 2) / perRow;
  const maxWidth = step * RADIUS * SLOT_FILL;

  return (
    <>
      <group ref={cylinder}>
        {slots.map(({ artwork, row, column }, index) => {
          const scatter = scatterFor(index);
          return (
            <Suspense key={`${row}-${column}`} fallback={null}>
              <Card
                artwork={ordered[artwork]!}
                angle={(column + scatter.angle) * step + (row ? step / 2 : 0)}
                y={(row ? -ROW_HEIGHT / 2 : ROW_HEIGHT / 2) + scatter.y}
                radius={RADIUS + scatter.depth}
                roll={scatter.roll}
                maxWidth={maxWidth}
                onOpen={onOpen}
              />
            </Suspense>
          );
        })}
      </group>
      {/* Subtle depth of field: pieces straight ahead are sharp, the edges soften. */}
      <EffectComposer>
        <DepthOfField worldFocusDistance={RADIUS} worldFocusRange={2.5} bokehScale={1.6} />
      </EffectComposer>
    </>
  );
}

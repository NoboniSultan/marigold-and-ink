/**
 * Draws the sketchbook's pages on 2D canvases, which three.js then uses as textures:
 * paper with a faint grain and a soft shadow toward the spine, then either an artwork
 * (whole, at its own proportions) or its caption (title, medium, year, credit).
 *
 * Colours and fonts come from the site's design tokens (styles/tokens.css), read at run
 * time, so the book follows the palette. Browser-only: jsdom has no canvas.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { Artwork } from '@shared/types/artwork.ts';
import { PAGE_HEIGHT, PAGE_MARGIN, PAGE_WIDTH, fitInside } from './sketchbook.ts';

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = Math.round((CANVAS_WIDTH * PAGE_HEIGHT) / PAGE_WIDTH);

/** Which edge of the page is at the spine: right pages bind on their left, and so on. */
export type SpineEdge = 'left' | 'right';

interface Palette {
  paper: string;
  ink: string;
  gray: string;
  rule: string;
  display: string;
  body: string;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let palette: Palette | null = null;
export function readPalette(): Palette {
  palette ??= {
    paper: token('--color-white'),
    ink: token('--color-ink'),
    gray: token('--color-gray'),
    rule: token('--color-rule'),
    display: token('--font-display'),
    body: token('--font-body'),
  };
  return palette;
}

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
  let image = images.get(src);
  if (!image) {
    image = new Promise((resolve, reject) => {
      const element = new Image();
      element.decoding = 'async';
      element.onload = () => resolve(element);
      element.onerror = () => {
        images.delete(src); // let a later attempt try again
        reject(new Error(`Couldn't load ${src}`));
      };
      element.src = src;
    });
    images.set(src, image);
  }
  return image;
}

function blankPage(spine: SpineEdge): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const colors = readPalette();
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colors.paper;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // A faint grain, so the page reads as paper rather than a flat panel.
  context.globalAlpha = 0.035;
  context.fillStyle = colors.ink;
  for (let i = 0; i < 2600; i++) {
    context.fillRect(Math.random() * CANVAS_WIDTH, Math.random() * CANVAS_HEIGHT, 1.5, 1.5);
  }
  context.globalAlpha = 1;

  // The gutter: pages darken softly where they curve into the spine.
  const shadowWidth = CANVAS_WIDTH * 0.12;
  const fromSpine = spine === 'left' ? 0 : CANVAS_WIDTH;
  const gradient = context.createLinearGradient(
    fromSpine,
    0,
    fromSpine + (spine === 'left' ? shadowWidth : -shadowWidth),
    0,
  );
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  context.fillStyle = gradient;
  context.fillRect(
    spine === 'left' ? 0 : CANVAS_WIDTH - shadowWidth,
    0,
    shadowWidth,
    CANVAS_HEIGHT,
  );
  return { canvas, context };
}

function toTexture(canvas: HTMLCanvasElement, mirrored: boolean): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // canvas pixels are sRGB; keep the colours true
  texture.anisotropy = 4; // stays crisp when the book is seen at an angle
  if (mirrored) {
    // The back of a leaf is seen from behind once turned; flip it so it reads correctly.
    texture.repeat.x = -1;
    texture.offset.x = 1;
  }
  return texture;
}

/** A plain page: for leaves far from the open spread, until they come near. */
export function blankTexture(spine: SpineEdge, mirrored: boolean): CanvasTexture {
  return toTexture(blankPage(spine).canvas, mirrored);
}

/** A right-hand page with the artwork drawn on it, whole. */
export async function artworkTexture(artwork: Artwork): Promise<CanvasTexture> {
  const image = await loadImage(artwork.image.thumb.src);
  const { canvas, context } = blankPage('left');
  const margin = CANVAS_WIDTH * PAGE_MARGIN;
  const { width, height } = fitInside(
    image.naturalWidth / image.naturalHeight,
    CANVAS_WIDTH - margin * 2,
    CANVAS_HEIGHT - margin * 2,
  );
  const x = (CANVAS_WIDTH - width) / 2;
  const y = (CANVAS_HEIGHT - height) / 2;
  // A soft shadow under the piece, as if it were tipped in on top of the paper.
  context.shadowColor = 'rgba(0, 0, 0, 0.22)';
  context.shadowBlur = 18;
  context.shadowOffsetY = 6;
  context.drawImage(image, x, y, width, height);
  return toTexture(canvas, false);
}

/**
 * The front cover: Ink board with the shop's name, like a stamped title, and a short
 * Marigold rule (Marigold on Ink, never on white). `aspect` is the board's width / height.
 */
export async function coverTexture(aspect: number): Promise<CanvasTexture> {
  const colors = readPalette();
  const marigold = token('--color-marigold');
  const titleFont = `400 76px ${colors.display}`;
  await document.fonts.load(titleFont);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = Math.round(CANVAS_WIDTH / aspect);
  const context = canvas.getContext('2d')!;
  context.fillStyle = colors.ink;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // A faint cloth grain.
  context.globalAlpha = 0.05;
  context.fillStyle = colors.paper;
  for (let i = 0; i < 3000; i++) {
    context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1.5, 1.5);
  }
  context.globalAlpha = 1;

  context.fillStyle = colors.paper;
  context.font = titleFont;
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.fillText('Marigold & Ink', canvas.width / 2, canvas.height * 0.42);
  context.fillStyle = marigold;
  context.fillRect(canvas.width / 2 - 40, canvas.height * 0.42 + 34, 80, 3);
  return toTexture(canvas, false);
}

/** A soft, blurred shadow for the book to rest on. */
export function shadowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const context = canvas.getContext('2d')!;
  // Draw the shape off-canvas and keep only its shadow (canvas `filter` isn't everywhere).
  const pad = 56;
  context.shadowColor = 'rgba(0, 0, 0, 0.32)';
  context.shadowBlur = 36;
  context.shadowOffsetX = canvas.width;
  context.fillRect(-canvas.width + pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);
  return toTexture(canvas, false);
}

/** Splits text into lines no wider than maxWidth (at the context's current font). */
function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A left-hand page with an artwork's caption: the details the site already shows for it
 * (title, medium and year, credit), and its place in the book. Mirrored, because it is the
 * back of the leaf before it (or the inside cover, which isn't: see `mirrored`).
 */
export async function captionTexture(
  artwork: Artwork,
  position: { number: number; total: number },
  mirrored: boolean,
): Promise<CanvasTexture> {
  const colors = readPalette();
  const titleFont = `400 58px ${colors.display}`;
  const detailFont = `400 26px ${colors.body}`;
  // Canvas text can't wait for web fonts by itself: load them first, or a fallback is drawn.
  await Promise.all([document.fonts.load(titleFont), document.fonts.load(detailFont)]);

  const { canvas, context } = blankPage('right');
  const left = CANVAS_WIDTH * 0.14;
  const maxWidth = CANVAS_WIDTH * 0.68;
  let y = CANVAS_HEIGHT * 0.56;

  context.textBaseline = 'alphabetic';
  context.fillStyle = colors.ink;
  context.font = titleFont;
  const titleLines = wrap(context, artwork.title, maxWidth);
  y -= (titleLines.length - 1) * 66;
  for (const line of titleLines) {
    context.fillText(line, left, y);
    y += 66;
  }

  // A short rule under the title, like a pencil line.
  context.fillStyle = colors.rule;
  context.fillRect(left, y - 30, 72, 2);
  y += 18;

  context.fillStyle = colors.gray;
  context.font = detailFont;
  const details = [
    [artwork.medium, artwork.year].filter(Boolean).join(', '),
    artwork.credit ?? '',
  ].filter(Boolean);
  for (const detail of details) {
    for (const line of wrap(context, detail, maxWidth)) {
      context.fillText(line, left, y);
      y += 36;
    }
  }

  context.font = `400 22px ${colors.body}`;
  context.fillText(`${position.number} / ${position.total}`, left, CANVAS_HEIGHT * 0.93);
  return toTexture(canvas, mirrored);
}

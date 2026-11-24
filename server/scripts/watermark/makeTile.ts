/**
 * Draws the preview watermark tile once, on a developer machine (which has fonts), into
 * assets/watermark-tile.png. The server only lays this image over previews, so it never
 * needs fonts of its own (a server without them would draw empty boxes).
 *
 *   node scripts/watermark/makeTile.ts
 *
 * Re-run it only to change the wording or look, and commit the new PNG.
 */
import path from 'node:path';
import sharp from 'sharp';

const WIDTH = 640;
const HEIGHT = 420;
const OUT = path.join(import.meta.dirname, '../../assets/watermark-tile.png');

// White letters with a thin dark edge, both faint, so the mark shows on light and dark art.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <g transform="rotate(-28 ${WIDTH / 2} ${HEIGHT / 2})" font-family="Georgia, 'Times New Roman', serif"
     text-anchor="middle" fill="#ffffff" fill-opacity="0.42" stroke="#000000" stroke-opacity="0.22" stroke-width="1.2">
    <text x="${WIDTH / 2}" y="${HEIGHT / 2 - 10}" font-size="46">Marigold &amp; Ink</text>
    <text x="${WIDTH / 2}" y="${HEIGHT / 2 + 40}" font-size="26" letter-spacing="10">PREVIEW</text>
  </g>
</svg>`;

const info = await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log(`watermark tile: ${OUT} (${info.width}×${info.height}, ${info.size} bytes)`);

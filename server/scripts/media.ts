/**
 * npm run media [-- --force]
 *
 * Turns the originals in media-source/ (gitignored, on the owner's machine only) into
 * committed WebP files in media/, updates media/manifest.json, and adds a "to fill in"
 * entry to content/artworks.json for every new artwork photo. Run it after adding,
 * replacing, or removing a photo, then commit media/ and content/.
 *
 *   --force   reprocess every image, even unchanged ones
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_DIR, MEDIA_DIR, MEDIA_SOURCE_DIR } from '../src/config/paths.ts';
import {
  EMPTY_MANIFEST,
  MANIFEST_FILE,
  loadManifest,
  type MediaCollection,
  type MediaManifest,
} from '../src/lib/mediaManifest.ts';
import {
  ARTWORKS_FILE,
  stubEntry,
  type ArtworkEntryInput,
} from '../src/modules/gallery/gallery.content.ts';
import { SETTINGS_ID, processCollection, removeStaleFiles } from './media/pipeline.ts';

const COLLECTIONS: MediaCollection[] = ['artworks', 'about'];

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

async function readPreviousManifest(): Promise<MediaManifest> {
  try {
    return await loadManifest(MEDIA_DIR);
  } catch {
    return EMPTY_MANIFEST; // first run, or an unreadable manifest: rebuild from scratch
  }
}

/** Adds a stub for every processed artwork image that has no entry yet. */
async function addContentStubs(
  manifest: MediaManifest,
): Promise<{ added: string[]; orphans: string[] }> {
  const file = path.join(CONTENT_DIR, ARTWORKS_FILE);
  let content: { artworks: ArtworkEntryInput[] };
  try {
    content = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      fail(`${file} is not valid JSON, so no entries were added. Fix it and run again.`);
    }
    content = { artworks: [] };
  }

  const described = new Set(content.artworks.map((entry) => entry.image));
  const added = Object.keys(manifest.artworks).filter((key) => !described.has(key));
  for (const key of added) {
    content.artworks.push(stubEntry(key, manifest.artworks[key]!.source));
  }
  if (added.length > 0) {
    await mkdir(CONTENT_DIR, { recursive: true });
    await writeFile(file, `${JSON.stringify(content, null, 2)}\n`);
  }

  const orphans = content.artworks
    .map((entry) => entry.image)
    .filter((key) => !(key in manifest.artworks));
  return { added, orphans };
}

const force = process.argv.includes('--force');
const previous = await readPreviousManifest();
const settingsChanged = previous.settings !== SETTINGS_ID;
const manifest: MediaManifest = { settings: SETTINGS_ID, artworks: {}, about: {} };

for (const collection of COLLECTIONS) {
  const sourceDir = path.join(MEDIA_SOURCE_DIR, collection);
  console.log(`\n${collection}: ${path.relative(process.cwd(), sourceDir)}`);

  const result = await processCollection({
    collection,
    sourceDir,
    mediaDir: MEDIA_DIR,
    previous: previous[collection],
    force: force || settingsChanged,
  }).catch((err: Error) => fail(err.message));

  // Guard against wiping the committed gallery when the originals aren't on this machine.
  if (collection === 'artworks' && Object.keys(result.images).length === 0) {
    fail(
      `No artwork photos found in ${sourceDir}. Nothing was changed. ` +
        '(The originals live only on the machine they were copied to.)',
    );
  }

  manifest[collection] = result.images;
  const removed = await removeStaleFiles(MEDIA_DIR, collection, result.images);
  console.log(
    `  ${result.processed.length} processed, ${result.unchanged.length} unchanged, ` +
      `${removed.length} old file(s) removed`,
  );
  for (const name of result.skipped) console.log(`  skipped (unsupported type): ${name}`);
}

await writeFile(path.join(MEDIA_DIR, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

const { added, orphans } = await addContentStubs(manifest);
if (added.length > 0) {
  console.log(
    `\nAdded ${added.length} "to fill in" entr${added.length === 1 ? 'y' : 'ies'} to content/${ARTWORKS_FILE}:`,
  );
  for (const key of added) console.log(`  ${key}`);
}
if (orphans.length > 0) {
  console.log(
    `\n⚠ These entries point at photos that no longer exist (the seed will refuse them):`,
  );
  for (const key of orphans) console.log(`  ${key}`);
}
console.log('\nDone. Commit media/ and content/.');

/**
 * Syncs content/artworks.json into the database and validates content/about.json.
 * Idempotent, and runs on every deploy (see render.yaml). It refuses to touch the database
 * if anything is inconsistent, so a bad content edit fails the deploy instead of breaking
 * the live gallery:
 * - every image in media/manifest.json has an entry, and every entry has an image;
 * - every file the manifest lists exists on disk (catches forgetting to commit media/);
 * - published entries have nothing left "to fill in";
 * - about.json is valid and its photo exists.
 */
import { CONTENT_DIR, MEDIA_DIR } from '../../config/paths.ts';
import { ContentError } from '../../lib/contentFile.ts';
import { findMissingMediaFiles, loadManifest } from '../../lib/mediaManifest.ts';
import { buildArtworkRows, loadArtworksFile } from '../../modules/gallery/gallery.content.ts';
import * as galleryService from '../../modules/gallery/gallery.service.ts';
import * as aboutService from '../../modules/about/about.service.ts';

export async function seedContent({
  contentDir = CONTENT_DIR,
  mediaDir = MEDIA_DIR,
}: { contentDir?: string; mediaDir?: string } = {}) {
  const manifest = await loadManifest(mediaDir);

  const missing = await findMissingMediaFiles(manifest, mediaDir);
  if (missing.length > 0) {
    throw new ContentError(
      'media/manifest.json lists files that are missing (commit media/):',
      missing,
    );
  }

  const rows = buildArtworkRows(await loadArtworksFile(contentDir), manifest);
  const about = await aboutService.loadAbout({ contentDir, mediaDir });

  const summary = await galleryService.syncContent(rows);
  return {
    ...summary,
    published: rows.filter((row) => row.isPublished).length,
    drafts: rows.filter((row) => !row.isPublished).length,
    aboutIsPlaceholder: about.isPlaceholder,
  };
}

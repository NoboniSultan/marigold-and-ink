/**
 * Validates the REAL content/ and media/ folders (every other test uses tests/fixtures).
 * The deploy runs the same checks in the seed, so this catches a bad content edit in CI,
 * before it can fail a deploy.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { REPO_ROOT } from '../../../config/paths.ts';
import { findMissingMediaFiles, loadManifest } from '../../../lib/mediaManifest.ts';
import { buildArtworkRows, loadArtworksFile } from '../gallery.content.ts';
import { buildAbout, loadAboutFile } from '../../about/about.content.ts';

const contentDir = path.join(REPO_ROOT, 'content');
const mediaDir = path.join(REPO_ROOT, 'media');

describe('the committed content and media', () => {
  it('match: every image has an entry, every entry has an image, nothing is missing', async () => {
    const manifest = await loadManifest(mediaDir);

    expect(await findMissingMediaFiles(manifest, mediaDir)).toEqual([]);
    const rows = buildArtworkRows(await loadArtworksFile(contentDir), manifest);
    expect(rows.length).toBeGreaterThan(0);
    buildAbout(await loadAboutFile(contentDir), manifest);
  });
});

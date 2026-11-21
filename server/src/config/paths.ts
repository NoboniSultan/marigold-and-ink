/**
 * Repository folders the server reads at runtime or in scripts. Resolved from this file's
 * location, so they work no matter which directory a command is started from.
 */
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

// CONTENT_DIR and MEDIA_DIR can be overridden by environment variables of the same name.
// Only the tests do that (vitest.config.js points them at tests/fixtures), so API tests
// don't depend on the owner's real photos. A separate test validates the real files.

/** Editable site content: artworks.json, about.json. Committed. */
export const CONTENT_DIR = process.env.CONTENT_DIR ?? path.join(REPO_ROOT, 'content');

/** Processed images and manifest.json, written by `npm run media`. Committed; served at /media. */
export const MEDIA_DIR = process.env.MEDIA_DIR ?? path.join(REPO_ROOT, 'media');

/** Original photos. Gitignored: they exist only on the owner's machine. */
export const MEDIA_SOURCE_DIR = path.join(REPO_ROOT, 'media-source');

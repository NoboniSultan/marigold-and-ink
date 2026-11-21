import type { AboutContent } from '@shared/types/about.ts';
import { CONTENT_DIR, MEDIA_DIR } from '../../config/paths.ts';
import { loadManifest } from '../../lib/mediaManifest.ts';
import { buildAbout, loadAboutFile } from './about.content.ts';

/** Reads and validates the About content. The seed calls this so a broken file fails a deploy. */
export async function loadAbout({
  contentDir = CONTENT_DIR,
  mediaDir = MEDIA_DIR,
}: { contentDir?: string; mediaDir?: string } = {}): Promise<AboutContent> {
  const [file, manifest] = await Promise.all([loadAboutFile(contentDir), loadManifest(mediaDir)]);
  return buildAbout(file, manifest);
}

// The files only change with a deploy, so they're read once per process. The promise is
// cached (not the result), so concurrent first requests share one read; a failed read is
// dropped so the next request retries.
let cached: Promise<AboutContent> | null = null;

export function getAbout(): Promise<AboutContent> {
  cached ??= loadAbout().catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}

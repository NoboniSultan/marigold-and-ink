import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ContentError, parseContent, readContentFile } from '../contentFile.ts';
import { ManifestError, loadManifest, parseManifest } from '../mediaManifest.ts';
import { slugify } from '../slug.ts';

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.resetModules();
});

async function tmpDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'content-lib-'));
  tmpDirs.push(dir);
  return dir;
}

describe('contentFile', () => {
  const schema = z.object({ title: z.string() }).strict();

  it('lists every schema problem with its path', () => {
    expect(() => parseContent('{"title": 1, "extra": true}', schema, 'x.json')).toThrow(
      /x\.json is invalid:\n- title: .*\n- \(file\): Unrecognized key: "extra"/,
    );
  });

  it('reports invalid JSON and unreadable files as ContentErrors', async () => {
    expect(() => parseContent('{', schema, 'x.json')).toThrow(
      new ContentError('x.json is not valid JSON'),
    );
    await expect(readContentFile('/no/such/file.json', schema)).rejects.toThrow(
      "Can't read /no/such/file.json",
    );
  });

  it('reads and validates a file', async () => {
    const file = path.join(await tmpDir(), 'ok.json');
    await writeFile(file, '{"title": "Fawn"}');

    expect(await readContentFile(file, schema)).toEqual({ title: 'Fawn' });
  });
});

describe('mediaManifest', () => {
  const variant = { src: '/media/artworks/a.thumb.11111111.webp', width: 1, height: 1 };
  const entry = { source: 'a.jpg', sourceHash: 'a'.repeat(64), thumb: variant, large: variant };

  it('accepts a valid manifest', () => {
    const text = JSON.stringify({ settings: 's', artworks: { a: entry }, about: {} });
    expect(parseManifest(text).artworks.a).toEqual(entry);
  });

  it.each([
    ['a non-slug key', { 'Not A Key': entry }],
    ['an external image URL', { a: { ...entry, thumb: { ...variant, src: 'https://x/a.webp' } } }],
    ['path traversal', { a: { ...entry, large: { ...variant, src: '/media/a/../../x.webp' } } }],
  ])('rejects %s', (_label, artworks) => {
    expect(() => parseManifest(JSON.stringify({ settings: 's', artworks, about: {} }))).toThrow(
      ManifestError,
    );
  });

  it('reports invalid JSON and a missing manifest with the fix', async () => {
    expect(() => parseManifest('nope')).toThrow('manifest.json is not valid JSON');
    await expect(loadManifest(await tmpDir())).rejects.toThrow(/Run `npm run media` first/);
  });
});

describe('aboutService.getAbout', () => {
  it('retries after a failed read instead of caching the failure', async () => {
    const aboutService = await import('../../modules/about/about.service.ts');
    const manifestModule = await import('../mediaManifest.ts');
    const spy = vi
      .spyOn(manifestModule, 'loadManifest')
      .mockRejectedValueOnce(new ManifestError('disk hiccup'));

    await expect(aboutService.getAbout()).rejects.toThrow('disk hiccup');
    await expect(aboutService.getAbout()).resolves.toMatchObject({ bio: expect.any(Array) });
    spy.mockRestore();
  });
});

describe('slugify', () => {
  it.each([
    ['Starry Night', 'starry-night'],
    ['  --Two   Faces!! ', 'two-faces'],
    ['Guayasamín', 'guayasamin'],
    ['!!!', ''],
  ])('%j → %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { ContentError } from '../../../lib/contentFile.ts';
import type { MediaManifest } from '../../../lib/mediaManifest.ts';
import { buildAbout, aboutFileSchema } from '../about.content.ts';

const manifest: MediaManifest = {
  settings: 'test',
  artworks: {},
  about: {
    me: {
      source: 'me.jpg',
      sourceHash: 'a'.repeat(64),
      thumb: { src: '/media/about/me.thumb.11111111.webp', width: 600, height: 700 },
      large: { src: '/media/about/me.large.22222222.webp', width: 1200, height: 1400 },
    },
  },
};

describe('GET /api/v1/about', () => {
  it('returns the photo and bio from content/about.json', async () => {
    const res = await request(createApp()).get('/api/v1/about');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      photo: {
        thumb: { src: '/media/about/me.thumb.11111111.webp', width: 6, height: 8 },
        large: { src: '/media/about/me.large.22222222.webp', width: 12, height: 16 },
        alt: 'The artist in a garden',
      },
      bio: ['First paragraph.', 'Second paragraph.'],
      isPlaceholder: false,
    });
  });
});

describe('buildAbout', () => {
  it('flags placeholder text', () => {
    const about = buildAbout(
      { photo: 'me', photoAlt: 'Me', bio: ['Real text.', 'PLACEHOLDER: write this'] },
      manifest,
    );
    expect(about.isPlaceholder).toBe(true);
  });

  it('refuses a photo that was not processed, listing the ones that were', () => {
    expect(() => buildAbout({ photo: 'nobody', photoAlt: 'x', bio: ['x'] }, manifest)).toThrow(
      new ContentError(`about.json: photo "nobody" isn't in media/manifest.json (available: me)`),
    );
  });

  it('requires at least one bio paragraph and rejects unknown fields', () => {
    expect(aboutFileSchema.safeParse({ photo: 'me', photoAlt: 'x', bio: [] }).success).toBe(false);
    expect(
      aboutFileSchema.safeParse({ photo: 'me', photoAlt: 'x', bio: ['x'], biography: 'x' }).success,
    ).toBe(false);
  });
});

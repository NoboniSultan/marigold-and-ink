# 7. Artwork content in files, images processed locally and committed

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

The gallery needs the owner's real artworks: about 40 phone photos (many HEIC), each with a title, medium, category, and sometimes a credit. There is no admin UI and no upload feature yet (both are later milestones), but the original spec also asks for admin CRUD endpoints for artworks.

Questions to settle:

1. **Where images live.** Object storage needs an account, credentials, and an upload flow, all out of scope. Storing images in Postgres bloats the free 1 GB database.
2. **Where artwork details live.** If both a content file and the admin API can edit an artwork, one must be the source of truth.
3. **Deploys.** The free Render plan runs the seed on every start, including restarts after idle sleep, so the seed runs often.

## Decision

**Images: processed on the owner's Mac, committed, served by the app.**

- Originals go in `media-source/`, which is gitignored and exists only on the owner's machine.
- `npm run media` (Sharp) writes two WebP sizes per image to `media/`, plus `media/manifest.json`. The two sizes are a 600px-wide thumbnail and a large image of at most 2000px on its long edge.
- It also:
  - auto-rotates each image;
  - converts it to sRGB;
  - **strips all metadata**, including GPS location (a test verifies this);
  - skips unchanged originals.
- HEIC is decoded with macOS `sips`, because Sharp's prebuilt binaries can't decode HEVC for patent-licensing reasons.
- File names contain a content hash, so Express serves `/media/...` with `Cache-Control: immutable`: a changed image always gets a new URL.
- About 15 MB for 39 images is acceptable in git.

**Details: `content/artworks.json` is the source of truth for the artworks it lists ("option A").**

- The seed validates the file against a strict schema and the manifest. It then syncs the database **by a per-row hash** stored in `artworks.content_hash`:
  - **New entry:** insert it.
  - **Changed entry:** overwrite the row, so the file wins.
  - **Unchanged entry:** leave the row alone. Admin edits made through the API therefore survive restarts until the owner edits that entry in the file.
  - **Removed entry:** delete the row.
- New photos get an unpublished "to fill in" entry automatically. A published entry may not contain "to fill in".
- Deleting a file-owned artwork through the API returns `409 ARTWORK_CONTENT_MANAGED`, because the seed would otherwise restore it.
- If anything is inconsistent, the seed fails before writing, and so does the deploy. Render then keeps serving the previous version. Examples:
  - an image with no entry, or an entry with no image;
  - a manifest file missing from disk;
  - duplicate slugs;
  - a bad `about.json`.
- CI validates the real files too (`content.real.test.ts`).

**Render:** the Blueprint no longer sets `rootDir: server`. Render hides files outside a service's root directory, and the server reads `content/` and `media/` at the repo root.

## Consequences

- The owner edits a JSON file and runs one command. Changes are reviewed in a PR like code, and history is in git.
- Images only change from a machine that has the originals, which is fine for one artist. The script refuses to run with an empty `media-source/artworks`, so it can't wipe the committed gallery.
- The admin API exists for the future admin UI. Creating an artwork through it needs a processed image that no entry uses, so it becomes practical once uploads exist.
- When an admin UI arrives, revisit this. The likely move is the database as the source of truth after a final import ("option B").
- Large binary files in git grow the repository. If the gallery grows past a few hundred images, move `media/` to object storage behind the same `/media` URLs.

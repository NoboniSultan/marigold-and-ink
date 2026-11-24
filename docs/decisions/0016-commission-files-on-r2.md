# 16. Commission files on Cloudflare R2

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Milestone 10 lets clients add reference photos to a commission, shows them the artist's work in progress, and delivers final files. Render's disk is wiped on every deploy, so files need storage elsewhere. The owner wanted no risk of a surprise bill, and decided: up to 10 reference photos of 15 MB each, from the request until work starts; final files up to 100 MB as JPEG, PNG, PDF, or TIFF; reference photos kept **90 days after the commission ends**; final files downloadable for **one year after full payment**; previews watermarked "Marigold & Ink · PREVIEW".

Cloudflare R2, Amazon S3, and Backblaze B2 were compared. S3's free plan suspends the account after six months, and on the paid plan downloads (beyond 100 GB a month) and a leaked access key can run up a bill with no hard cap. R2 has no download (egress) fees at all, 10 GB free a month, and tokens that can be limited to one bucket.

## Decision

- **Storage: a private R2 bucket**, reached through the S3 API (`adapters/r2Storage.ts`, the only code that talks to it; tests pass a fake). Settings `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` switch uploads on together; without them the file endpoints answer 503 `FILES_UNAVAILABLE` and the pages hide uploads.
- **Never public.** Every read is a signed link for one file that expires in 10 minutes; the list endpoint signs fresh ones each time, and the page refreshes them every five minutes. The Content-Security-Policy allows images from that one bucket's address only.
- **Uploads go through the server**, as the raw request body (`X-Filename` carries the name), so nothing unchecked is stored:
  - the real type is read from the file's first bytes, never trusted from the name or header;
  - reference photos and previews are re-encoded by sharp: upright, at most 2400 px, JPEG, **with no metadata** (so no GPS, camera, or time), and a decompression-bomb limit; a file that isn't really an image is refused;
  - previews get a watermark tile (drawn once on a developer machine with fonts, `assets/watermark-tile.png`, so the server needs none), repeated across the image; the clean image is never stored;
  - final files are stored exactly as uploaded;
  - at most 60 uploads an hour per user, and body limits just above each kind's size limit.
- **Who sees what:** the client sees their reference photos and previews, and final files only once the commission is paid in full; the admin sees everything. Clients add and remove reference photos until work starts (inquiry, quoted, deposit paid); previews and finals are added by the admin after the deposit.
- **Keeping periods (`files.rules.ts`):** reference photos are deleted 90 days after the commission ends (completed, cancelled, or refunded); previews and final files a year after full payment, or 90 days after a commission ended without it. A sweep runs at startup and daily. Account deletion removes the client's reference photos at once (rows in the deletion's transaction, the stored files right after it commits).
- **HEIC:** iPhones convert photos to JPEG when a web page asks for JPEG, PNG, or WebP, which the upload does; HEIC files uploaded from a computer are refused with the list of types.

## Consequences

- Storage should cost nothing at this size (R2's free tier), and downloads can never be billed. Neither R2 nor S3 has a hard spending cap; the limits above are what keep usage small.
- Uploads are held in memory while they're processed (up to about 100 MB for a final file). Fine for one at a time on Render's free plan; streaming straight to storage is in the backlog if large files become common.
- If storage fails after a row is deleted (the rare order the code avoids), an object could be left behind; it's private and unlisted. An orphan sweep is in the backlog.
- The privacy policy must mention reference photos, R2 (Cloudflare) as a processor, and the keeping periods before uploads are switched on in production.

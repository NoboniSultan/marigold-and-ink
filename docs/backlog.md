# Backlog

Work that is out of scope for the current build session (milestones 0 to 8). Each item links back to the relevant section of [proposal.md](proposal.md).

## Deferred features

- **File handling** (proposal 6.5): reference photo uploads to object storage, server-side watermarked previews (Sharp), and final files served through expiring signed URLs.
- **Messaging** (6.7): a message thread per commission. The `messages` table is created in milestone 2; its endpoints come later.
- **Email notifications** (6.7): new messages, payment reminders, status changes, shipping updates, and the donation amount in order confirmations.
- **Background jobs**: BullMQ on Redis for email and scheduled tasks.
- **Slots and waitlist** (6.6): a maximum number of active commissions per period, with automatic promotion from the waitlist.
- **Shipping** (7): addresses, live rates (EasyPost or Shippo), labels, tracking webhooks, insurance, and local pickup for furniture.
- **Shop** (6.10): products, variants, cart, inventory with row-level locking for one-of-a-kind pieces, expiring reservations, and an inventory movement log.
- **Admin dashboard UI and analytics** (6.8): revenue by month, turnaround time, popular styles, best sellers.
- **Public transparency page** (8): the frontend for the running donation total. Its API endpoint comes in milestone 8.
- **Monthly donation report** (8): total sales, donations owed, and donations paid out.

## Ideas and notes

- **Make `REDIS_URL` required** once a feature (BullMQ jobs) depends on Redis. It is validated but optional for now.
- **Shared rate-limit store**: login and registration counters are in memory, per instance, and reset on restart. Move them to Redis if the API ever runs on more than one instance.
- **"Log out everywhere"**: `authRepository.deleteSessionsForUser` already revokes a user's sessions by matching the JSON `userId` (used when Google takes over an unverified account). If it becomes frequent, add an indexed `user_id` column to `sessions`.
- **Password reset**: email verification is done (milestone 5c). Reset can reuse the same code mechanism (`email_verifications` with a purpose column): email a code, set a new password, sign out other sessions.
- **Real email in production**: buy a domain, verify it in Resend, and set `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on Render. Until then production email sign-up says "opens soon" (docs/setup-google-and-email.md).
- **Connect Google from account settings**: let a logged-in user link Google deliberately (today linking happens by matching verified email at sign-in).
- **Real backups before real customers use the site**: Neon Free keeps only 6 hours of restore history and 1 GB of storage. Move to a paid Neon or Render Postgres plan; only `DATABASE_URL` changes. On a paid Render web instance, also move `migrate:up && seed` to `preDeployCommand`.
- **Browser tests in CI:** milestone 5b was checked in headless Chrome by hand (Playwright driving the real site: morph, Escape close, 3D, register → commission). Add Playwright to CI so the shared-layout exit and the 3D scene, which jsdom can't run, are tested on every PR.
- **Trim the main bundle** (about 168 KB gzipped): Motion's `LazyMotion` with `m` components loads only the features in use. `layoutId` needs the `domMax` feature set, so measure before and after.
- **Client dashboard** ("my commissions", quote acceptance): the commission form shows a confirmation, but there's no page listing a client's requests yet.
- **Dev-dependency audit**: `npm audit` reports a high-severity ReDoS advisory in `picomatch`, which the Vitest toolchain pulls in (dev-only; production dependencies report 0 vulnerabilities). npm's suggested fix downgrades Vitest by two major versions, so it was not applied. Re-check when Vitest or tinyglobby release a fix.
- **Health check for Redis** once Redis is used.
- **Currency** (milestone 7): `payments.currency` is required. Confirm the shop's currency with the owner and put it in config.
- **Replace placeholder prices and settings** before taking real orders: `server/src/db/seeds/pricing.placeholder.js`, `DEPOSIT_PERCENT=50`, and `COMMISSION_REVISION_LIMIT=2` (in `render.yaml` and `.env`) are placeholders. Deactivate the placeholder rules and insert real ones.
- **Admin pricing management**: endpoints to list, create, and deactivate pricing rules, so prices change without a migration.
- **Rush fee shape**: `pricing_rules` stores a flat `amount_cents`. If the owner wants rush as a percentage, add a column and a branch in `pricing.engine.ts`.
- **Re-quote after sending**: a sent quote can't change. If the price must change after sending, add a "revise quote" flow (supersede the sent quote, and move the commission back to inquiry or keep it quoted, as the owner decides).
- **Refund flow** (milestone 7): `→ refunded` is reserved for the refund flow (`via: 'refund'`), so the status can never claim a refund that didn't move money.
- **Adjustment note visibility**: clients currently see the quote's `adjustmentNote`. Decide whether it is client-facing ("returning client discount") or internal-only.
- **Donation adjustment history** (milestone 8): partial refunds need an auditable adjustment record; design it with the refund-after-payout rule.
- **Artwork uploads** (with file handling): an upload flow that produces processed images like `npm run media` does. Until then, `POST /admin/artworks` can only use a processed image that no content entry claims. See ADR 0007.
- **Revisit the content source of truth** when the admin UI exists: probably make the database the source after a final import from `content/artworks.json` (ADR 0007, "option B").
- **Move `media/` to object storage** if the gallery grows past a few hundred images. Keep the `/media/...` URLs.
- **"Featured" flag for the home carousel**: for now the carousel can show the first published artworks in gallery order. Add a `featured` field if the owner wants to choose them separately.
- **Owner content to fill in:** the 30 "to fill in" drafts in `content/artworks.json`, written alt text for the published pieces (currently "title, medium"), years, the About bio and both photo descriptions (`content/about.json`), the site text in `client/src/content/copy.ts` (typewriter lines, main button, charity line), and the *Floral* image (a digital flower; not in `media-source` yet).

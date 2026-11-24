# Backlog

Work that is out of scope for the current build session (milestones 0 to 9). Next: milestone 10, file uploads and delivery; then milestone 11, US shipping. Each item links back to the relevant section of [proposal.md](proposal.md).

## Deferred features

- **File handling** (proposal 6.5): reference photo uploads to object storage, server-side watermarked previews (Sharp), and final files served through expiring signed URLs.
- **Messaging** (6.7): a message thread per commission. The `messages` table is created in milestone 2; its endpoints come later.
- **Email notifications** (6.7): new messages, payment reminders, status changes, shipping updates, and the donation amount in order confirmations.
- **Background jobs**: BullMQ on Redis for email and scheduled tasks.
- **Slots and waitlist** (6.6): a maximum number of active commissions per period, with automatic promotion from the waitlist.
- **Shipping** (7): addresses, live rates (EasyPost or Shippo), labels, tracking webhooks, insurance, and local pickup for furniture.
- **Shop** (6.10): products, variants, cart, inventory with row-level locking for one-of-a-kind pieces, expiring reservations, and an inventory movement log.
- **Admin dashboard UI and analytics** (6.8): revenue by month, turnaround time, popular styles, best sellers.

## Ideas and notes

- **Scheduled retry for pending trees:** today they're retried after the next payment and at startup. Move it to the background jobs when those exist.
- **Scheduled cleanup of expired codes:** since milestone 8d expired `email_verifications` rows are deleted whenever a new code is issued; move it to the background jobs when those exist, so an unused address can't linger in a quiet week.
- **Digital Humani production** goes with live Stripe: production key, `DIGITALHUMANI_ENVIRONMENT=production`, and lifting the config check (docs/setup-digital-humani.md).

- **Owner decisions for later milestones (2026-11-22):**
  - **Shipping:** physical and mixed-media work ships within the US only; digital work is sold worldwide.
  - **Donations:** 25% of each commission's full price, as trees through Digital Humani (One Tree Planted project), requested automatically once a commission is fully paid; built in milestone 8 (ADR 0013).
- **Artwork alt text and titles:** the 30 pieces published in milestone 7d use their title as alt text, which tells a screen-reader user little. Ask the owner for a one-line description of each, and for better titles where the file name shows (Clay 2, Portrait Example, Sketch 1).

- **Make `REDIS_URL` required** once a feature (BullMQ jobs) depends on Redis. It is validated but optional for now.
- **Shared rate-limit store**: login and registration counters are in memory, per instance, and reset on restart. Move them to Redis if the API ever runs on more than one instance.
- **"Log out everywhere"**: `authRepository.deleteSessionsForUser` already revokes a user's sessions by matching the JSON `userId` (used when Google takes over an unverified account). If it becomes frequent, add an indexed `user_id` column to `sessions`.
- **Connect Google from account settings**: let a logged-in user link Google deliberately (today linking happens by matching verified email at sign-in).
- **Real backups before real customers use the site**: Neon Free keeps only 6 hours of restore history and 1 GB of storage. Move to a paid Neon or Render Postgres plan; only `DATABASE_URL` changes. On a paid Render web instance, also move `migrate:up && seed` to `preDeployCommand`.
- **Browser tests in CI:** milestone 5b was checked in headless Chrome by hand (Playwright driving the real site: morph, Escape close, 3D, register → commission). Add Playwright to CI so the shared-layout exit and the 3D scene, which jsdom can't run, are tested on every PR.
- **Trim the main bundle** (about 168 KB gzipped): Motion's `LazyMotion` with `m` components loads only the features in use. `layoutId` needs the `domMax` feature set, so measure before and after.
- **Client dashboard** (quote acceptance, messages): the account page (milestone 7c) lists a client's commissions; accepting a quote and messaging aren't built.
- **Migration-tool audit** (found in milestone 6): `npm audit` reports 3 moderate advisories in the server's production dependencies, all through `node-pg-migrate` 9.0.0 → `glob` 13.x (GHSA-3g3m-2fjr-6pw4) → `minimatch` 10.x (GHSA-g3hv-75wg-m249). They only run during `migrate:up`, on our own fixed file patterns, never on visitor input. Patched `glob` 14 / `minimatch` 11 exist, but `node-pg-migrate` pins `glob ~13.0.0`, and npm's suggested fix is a downgrade to `node-pg-migrate` 7, so neither was applied. Re-check when `node-pg-migrate` releases an update; an npm `overrides` entry is the fallback if it doesn't.
- **Health check for Redis** once Redis is used.
- **Replace placeholder prices and settings** before taking real orders: `server/src/db/seeds/pricing.placeholder.js`, `DEPOSIT_PERCENT=50`, and `COMMISSION_REVISION_LIMIT=2` (in `render.yaml` and `.env`) are placeholders. Deactivate the placeholder rules and insert real ones.
- **Admin pricing management**: endpoints to list, create, and deactivate pricing rules, so prices change without a migration.
- **Rush fee shape**: `pricing_rules` stores a flat `amount_cents`. If the owner wants rush as a percentage, add a column and a branch in `pricing.engine.ts`.
- **Re-quote after sending**: a sent quote can't change. If the price must change after sending, add a "revise quote" flow (supersede the sent quote, and move the commission back to inquiry or keep it quoted, as the owner decides).
- **Shipping and tax on the final payment** (with shipping): the balance is charged as quoted. Add the shipping cost for physical and mixed-media work, and decide on sales tax (Stripe Tax or a fixed rule) with the owner.
- **Refunds after the final payment** (milestone 7 decision): they move money only. If a commission refunded in full after delivery should end as `refunded`, add those transitions to the state machine.
- **Delayed payment methods** (bank debits, etc.): Checkout is cards-only so `checkout.session.completed` means paid. Others need the `checkout.session.async_payment_succeeded` / `_failed` events.
- **Publish the Google sign-in app** once the contact email is in: Google Cloud → OAuth consent screen → app name, support email, homepage `https://noboni.art`, privacy policy `https://noboni.art/privacy`, authorized domain `noboni.art` (verified in Google Search Console with a TXT record at Porkbun), then **Publish app**.
- **Quote commission #2 on the live site** (owner, 2026-11-24): a test request waiting at `inquiry`. With milestone 9 deployed: Admin → Commissions → #2 → Generate quote → Send.
- **Keep the privacy policy current** (`client/src/content/privacy.md`, with `docs/privacy-data-inventory.md`) as features are added: reference uploads, messaging, shipping addresses.
- **Admin screens still to come:** artworks (today `content/artworks.json` or the API), pricing rules, and users.
- **Payment dates in the report** (ADR 0015): payments are dated by when Checkout started. Add a `succeeded_at` column if a payment ever lands in the wrong month.
- **Two paid sessions for one stage** can't both be recorded (ADR 0011): the second event would keep failing and retrying. Practically impossible with page reuse and expiry on cancel; if it ever happens, refund it automatically like a late payment.
- **Adjustment note visibility**: clients currently see the quote's `adjustmentNote`. Decide whether it is client-facing ("returning client discount") or internal-only.
- **Donation adjustment history** (milestone 8): partial refunds need an auditable adjustment record; design it with the refund-after-payout rule.
- **Artwork uploads** (with file handling): an upload flow that produces processed images like `npm run media` does. Until then, `POST /admin/artworks` can only use a processed image that no content entry claims. See ADR 0007.
- **Revisit the content source of truth** when the admin UI exists: probably make the database the source after a final import from `content/artworks.json` (ADR 0007, "option B").
- **Move `media/` to object storage** if the gallery grows past a few hundred images. Keep the `/media/...` URLs.
- **Owner content to fill in:** the 30 "to fill in" drafts in `content/artworks.json`, written alt text for the published pieces (currently "title, medium"), years, the About bio and both photo descriptions (`content/about.json`), the site text in `client/src/content/copy.ts` (typewriter lines, main button, charity line), and the *Floral* image (a digital flower; not in `media-source` yet).

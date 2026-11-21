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
- **"Log out everywhere"**: add a `user_id` column to `sessions` so all of a user's sessions can be revoked (e.g. after a password change).
- **Password reset and email verification**: these need the email feature.
- **Real backups before real customers use the site**: Neon Free keeps only 6 hours of restore history and 1 GB of storage. Move to a paid Neon or Render Postgres plan; only `DATABASE_URL` changes. On a paid Render web instance, also move `migrate:up && seed` to `preDeployCommand`.
- **Same-site client hosting** (milestone 5): the session cookie requires the React client and the API to be on the same site (Express serves the build, or a rewrite to `/api`).
- **Dev-dependency audit**: `npm audit` reports a high-severity ReDoS advisory in `picomatch`, which the Vitest toolchain pulls in (dev-only; production dependencies report 0 vulnerabilities). npm's suggested fix downgrades Vitest by two major versions, so it was not applied. Re-check when Vitest or tinyglobby release a fix.
- **Health check for Redis** once Redis is used.
- **Currency** (milestone 7): `payments.currency` is required. Confirm the shop's currency with the owner and put it in config.
- **Replace placeholder prices and settings** before taking real orders: `server/src/db/seeds/pricing.placeholder.js`, `DEPOSIT_PERCENT=50`, and `COMMISSION_REVISION_LIMIT=2` (in `render.yaml` and `.env`) are placeholders. Deactivate the placeholder rules and insert real ones.
- **Admin pricing management**: endpoints to list, create, and deactivate pricing rules, so prices change without a migration.
- **Rush fee shape**: `pricing_rules` stores a flat `amount_cents`. If the owner wants rush as a percentage, add a column and a branch in `pricing.engine.js`.
- **Re-quote after sending**: a sent quote can't change. If the price must change after sending, add a "revise quote" flow (supersede the sent quote, and move the commission back to inquiry or keep it quoted, as the owner decides).
- **Refund flow** (milestone 7): `→ refunded` is reserved for the refund flow (`via: 'refund'`), so the status can never claim a refund that didn't move money.
- **Adjustment note visibility**: clients currently see the quote's `adjustmentNote`. Decide whether it is client-facing ("returning client discount") or internal-only.
- **Donation adjustment history** (milestone 8): partial refunds need an auditable adjustment record; design it with the refund-after-payout rule.
- **Artwork full-text search index** (milestone 5).

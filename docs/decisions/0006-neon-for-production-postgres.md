# 6. Host the production database on Neon

- **Status:** Accepted. Supersedes the database part of [ADR 0005](0005-hosting-on-render.md); the API stays on Render.
- **Date:** 2026-11-20

## Context

The first Blueprint sync failed with "cannot have more than one active free tier database". Render allows one free Postgres per workspace, and the owner's workspace already had one. Even without that limit, a free Render database is deleted 30 days after creation and has no backups.

Options considered:

1. **Delete the existing free Render database.** No code change, but the 30-day expiry remains.
2. **Neon Free.** Hosted Postgres with a permanent free plan (no expiry, no credit card), 1 GB per project, and 100 compute-hours per month. It sleeps after 5 minutes idle and wakes in a few hundred milliseconds. Backups are limited (6 hours of restore history).
3. **Paid Render Postgres.** Everything stays in one place, with backups, for a monthly fee.

## Decision

Use **Neon Free**, in a dedicated `marigold-and-ink` project on Postgres 17, in AWS US West (Oregon) next to the Render service.

- **No Render database:** `render.yaml` no longer declares one. `DATABASE_URL` is entered in the Render Dashboard (`sync: false`) and never committed.
- **Direct connection, not pooled:** use Neon's direct connection string (the host has no `-pooler`). Neon's pooler runs in transaction mode, which breaks the session-level advisory lock that node-pg-migrate takes while migrating. The app already keeps its own pool of 10 connections.
- **TLS:** `sslmode=verify-full` means the connection is encrypted, and Neon's certificate and hostname are verified. (`pg` treats `sslmode=require` the same way but logs a deprecation warning.)
- **Channel binding:** `pg` reads `channel_binding=require` from the URL but ignores it. The new `db/connection.js` turns it into `enableChannelBinding`, so the password login (SCRAM-SHA-256-PLUS) is bound to the TLS connection. The pool and the migration runner share this config.

## Consequences

- Free, with no 30-day deadline. The owner's other Render database is untouched.
- Two vendors: the API on Render and the database on Neon. The app only knows `DATABASE_URL`, so moving to paid Render Postgres or another host later means changing one setting.
- The first query after Neon has slept takes a few hundred milliseconds longer. Render's free API also sleeps, so the database is never the slow part of a cold start.
- Backups on the free plan are limited to 6 hours of history. Before real customers use the site, move to a plan with real backups (Neon paid or Render paid).
- Traffic between Render and Neon goes over the public internet, so TLS with full verification is required, not optional.

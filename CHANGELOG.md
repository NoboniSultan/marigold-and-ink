# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one entry per milestone.

## [Unreleased]

## [0.6.0] - 2026-11-21 (Milestone 5b: the website)

### Added

- **The React site** (`client/`, TypeScript): Vite, React 19, React Router 8, TanStack Query, CSS Modules on the brand tokens, self-hosted fonts, and the square logo with a thin Ink border.
  - **Home:**
    - the typewriter hero on CSS-only notebook paper (custom `useTypewriter`);
    - a user-controlled featured carousel with three layered, direction-aware transitions, custom arrows, a progress bar, keyboard and swipe.
  - **Gallery:**
    - Grid mode with category, tag, search and pages, all in the URL, and a shared-layout morph into a full-screen detail view (Escape, backdrop, and close button; scroll lock);
    - a 3D Explore mode (React Three Fiber cylinder with eased rotation, hover tilt, and subtle depth of field), code-split so three.js loads only when opened.
  - **About:** an ink-spread photo reveal, the bio, and a closing photo. Each artwork also has its own page.
  - **Accounts and commissions:** login and register; a protected commission form built from the priced options, showing the server's errors.
  - **Throughout:** reduced-motion fallbacks everywhere, accessible focus rings, skip link, and live regions.
- `GET /auth/session` (always 200: the user or `null`) and `GET /pricing/options` (what can be requested, without prices).
- **Express serves the built site** (same origin): hashed assets are cached for a year, and page URLs fall back to `index.html`; the strict CSP is unchanged.
- **Content:**
  - descriptive photo names (e.g. `embrace.jpg`, `artist-with-flowers.jpg`);
  - *Embrace* credited "after Oswaldo Guayasamín";
  - an optional closing photo on the About page.
- Accent-insensitive search ("guayasamin" finds "Guayasamín").
- **CI:** a "Client: lint, typecheck, test, build" job. Render builds the client before starting the API.
- **Docs:** `docs/motion.md` (the full animation map, including later milestones) and ADR 0009 (client stack).
- **Tests:** 14 new server tests (652 total) and 43 client tests. The site was also checked in headless Chrome against both the dev server and the production build: register → submit a commission, the morph, Escape, 3D, phone layout, reduced motion, and no console errors.

### Changed

- **Route changes fade the new page in** instead of crossfading. Keeping the old page mounted during a fade-out made it re-render against the new URL and caused a login redirect loop (see `docs/motion.md`).

## [0.5.0] - 2026-11-21 (Milestone 5a: gallery API, content, and images)

### Added

- **Gallery API:**
  - Public `GET /artworks` with pagination, category and tag filters, and full-text search ranked by relevance; `/artworks/:slug`, `/artworks/categories`, `/tags`.
  - Drafts are never returned publicly, and answer exactly like missing artworks.
- **Admin API** under `/api/v1/admin` (one router-level admin guard): artworks list (with drafts) / get / create / update / delete, and tags list / create / rename / delete.
- **About:** `GET /about` from `content/about.json` (photo, alt text, bio; placeholder text flagged).
- **`npm run media`:** turns originals in the gitignored `media-source/` into a 600px and a 2000px WebP per image in `media/`, plus `manifest.json`.
  - Auto-rotates, converts to sRGB, and **strips all metadata, including GPS**.
  - Content-hashed file names; unchanged originals are skipped.
  - HEIC is decoded through macOS `sips`.
- **`content/artworks.json`:** the owner-edited source of truth, with a strict schema. New photos get an unpublished "to fill in" entry. It holds 7 described artworks and 30 drafts.
- **Content seed:**
  - Syncs the file into the database by per-row hash. A changed entry overwrites; an unchanged one keeps admin edits; a removed one is deleted.
  - Refuses to change anything, failing the deploy, if content and images disagree.
- `/media/artworks` and `/media/about` are served with year-long `immutable` caching, before sessions. The manifest is not exposed.
- **Migration:** image paths and sizes, `alt_text` (required once published), `year`, `credit`, `content_hash`, and a weighted, generated `search_vector` with a GIN index.
- **TypeScript:**
  - Node runs `.ts` directly (type stripping); `npm run typecheck` runs in CI.
  - The state machine, pricing engine, `AppError`, and `withTransaction` were converted.
  - Shared API types are in `shared/types/` (`Artwork`, `AdminArtwork`, `Tag`, `AboutContent`, response envelopes), checked with `satisfies`.
- **CI:**
  - a type-check step;
  - a step that seeds the real content and boots the server under plain Node, as Render does;
  - a test that validates the real `content/` and `media/`.
- ADR 0007 (content files and media pipeline), ADR 0008 (TypeScript via type stripping), and `docs/typescript-guide.md` (with four conversions left for the owner).
- 128 new tests (634 total), including:
  - a test proving GPS/EXIF data is removed;
  - the seed's sync rules;
  - admin auth on every admin route;
  - search edge cases.

### Changed

- `render.yaml` no longer sets `rootDir`. Render hides files outside it, and the server reads `content/` and `media/` at the repo root. Build and start commands now `cd server`.
- `artworks.image_url` was replaced by processed image paths.

## [0.4.0] - 2026-11-20 (Milestone 4: commission state machine and pricing engine)

### Added

- **State machine** (`commissions.stateMachine.js`): the approved transition table as data, covering actors (client, admin, system), guards (revision limit, digital vs. physical), effects (revision count), and dedicated flows (`via: 'quote' | 'refund'`). It provides `canTransition`, `assertTransition` (409 / 403 / 422), and `availableTransitions`.
- **Commission endpoints:** create (client only; size + medium must be priced; price fields ignored), list (own for clients, all for admins, status filter, pagination), detail with available actions, status changes, and event history.
- **`applyTransition`:** row lock (`FOR UPDATE`), state-machine check, update, and event insert in one transaction. It can join a caller's transaction (the quote flow, and the Stripe webhook in milestone 7).
- **Pricing engine** (`pricing.engine.js`): a pure `calculateQuote` returning itemized line items in integer cents. Missing or ambiguous rules are refused (422), never silently $0.
- **Quotes module:** generate a draft (inquiry only; regenerating supersedes the old draft), admin adjustment with a required note, and send. Sending stores total, deposit, and balance and moves the commission to `quoted` in one transaction. Clients never see drafts.
- `lib/money.js`: integer-cent helpers, half-up percentages, and a deposit split that always adds up to the total.
- Required settings `DEPOSIT_PERCENT` and `COMMISSION_REVISION_LIMIT`, with no defaults in code.
- Placeholder price seed, inserted only into an empty pricing table.
- 100% coverage thresholds for the state machine, the pricing engine, and money helpers (CI fails below them), plus global thresholds.
- `docs/state-machine.md` (diagram, table, error codes) and a request-flow sequence diagram in `docs/architecture.md`.
- 365 new tests (506 total): every one of the 144 status pairs × 3 actor types, every pricing combination, concurrency, rollback, and schema-consistency checks.

### Fixed

- The startup config check no longer hides a missing `DATABASE_URL` when another variable is absent.

## [0.3.1] - 2026-11-20 (Milestone 3: first deploy)

### Deployed

- The API is live at https://marigold-and-ink-api.onrender.com (Render free plan), with Postgres 17 on Neon. Verified in production: health check with database ping, security headers, HTTP-to-HTTPS redirect, error shapes, login rate limiting, and the CSRF origin check.

### Changed

- The production database moved from Render Postgres to Neon Free (ADR 0006). Render allows one free database per workspace, and its free tier expires after 30 days. `render.yaml` no longer declares a database; `DATABASE_URL` is entered in the Render Dashboard.

### Added

- `db/connection.js`: a shared pg connection config for the pool and the migration runner. It honors `channel_binding=require` from the connection string, which pg otherwise ignores. TLS verification comes from `sslmode=verify-full`.

## [0.3.0] - 2026-11-17 (Milestone 3: authentication, CI, deploy config)

### Added

- Auth endpoints: `POST /auth/register`, `/auth/login`, `/auth/logout`. Users endpoints: `GET /users/me`, `GET /users/:id` (owner or admin), and admin-only `GET /users` (paginated).
- Server-side sessions in Postgres (express-session + connect-pg-simple) via a new `sessions` migration. The cookie is `httpOnly`, `SameSite=Lax`, with `Secure` and the `__Host-` prefix in production. Sessions roll over 7 days, and the session ID is regenerated on login.
- `requireAuth` (re-reads the user on every request), `requireRole`, `requireOwnerOrAdmin`, and a pure `canAccessOwnedResource` rule.
- bcrypt password hashing (cost 12). Password policy: 12+ characters, at most 72 bytes. Logins take the same time and give the same `INVALID_CREDENTIALS` response for an unknown email or a wrong password.
- Rate limits: 10 failed logins per IP + email per 15 minutes; 5 registrations per IP per hour (configurable).
- CSRF origin check: state-changing requests from an `Origin` outside `CORS_ORIGINS` get `403 CSRF_ORIGIN_MISMATCH`.
- `validate()` middleware (zod, results on `req.validated`), pagination helpers, and duplicate-email translation to `409 EMAIL_TAKEN`.
- Idempotent admin seed (`npm run seed`) from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- GitHub Actions CI: lint, format check, migrations, and tests with coverage against a Postgres 17 service container. `main` now requires a PR and this check.
- Render Blueprint (`render.yaml`): web service and Postgres 17. It deploys only after CI passes, and runs migrations and the seed on start.
- ADR 0004 (sessions in Postgres) and ADR 0005 (Render).
- 60 new tests: 141 in total.

### Changed

- `pg` now parses `bigint` columns as JavaScript numbers instead of strings.
- New optional environment variables: `TRUST_PROXY`, `BCRYPT_ROUNDS`, `SESSION_MAX_AGE_DAYS`, and `RATE_LIMIT_*`. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are used by the seed.

## [0.2.0] - 2026-11-17 (Milestone 2: database schema)

### Added

- `node-pg-migrate` with plain SQL migrations, a `migrator.js` library (used by tests), and `migrate:up`, `migrate:down [n|all]`, and `migrate:create` scripts.
- Seven migrations: users; artworks, tags, artwork_tags; pricing_rules; commissions, commission_events, quotes; payments, processed_webhook_events; files, messages; charities, donations.
- Shared `set_updated_at()` trigger, the `commission_status` and `fulfillment_type` domains, `citext` emails, and an append-only trigger on `commission_events`.
- Database-level money invariants: deposit plus balance equals total, positive payment amounts, one successful payment per stage, unique Stripe IDs, one donation per payment, one active charity, and one current quote per commission.
- `docs/data-model.md`: Mermaid ER diagram and an explanation of every constraint and index. It was verified against the live schema (14 tables, 98 columns).
- ADR 0003: migration tool and schema conventions.
- Test factories (`tests/factories/`). The test database is migrated automatically before each run.
- 42 new tests: migrations up, down, and step-by-step redo with no leftover objects; every key constraint rejects bad data.

## [0.1.0] - 2026-11-17 (Milestone 1: server foundation)

### Added

- Docker Compose: dev Postgres 17 (host port 5434), test Postgres 17 (5433), and Redis 7, each with health checks and named volumes.
- `server/` package (ES modules, Node 26) with `dev`, `start`, `test`, `test:watch`, `test:coverage`, `lint`, `format`, and `format:check` scripts.
- `config/env.js`: zod-validated environment. The app refuses to boot and lists every invalid variable.
- Structured logging with pino. Every log line written during a request carries its request ID, via AsyncLocalStorage, including lines from services. Passwords and auth headers are redacted.
- `X-Request-Id` middleware (reuses a safe incoming ID or generates a UUID) and one log line per request with status and duration.
- `AppError` hierarchy (400, 401, 403, 404, 409, 422, 429, 503) and a central error handler that produces `{ error: { code, message, details } }` and never leaks internal messages or stack traces.
- 404 handler (`ROUTE_NOT_FOUND`), 100 KB JSON body limit, helmet, and a CORS allow-list.
- `db/pool.js` (a single pg pool) and `withTransaction()` (commit on success, rollback on error, client always released).
- `GET /api/v1/health` with a database ping (200, or 503 when the database is down).
- `app.js` / `server.js` split, with graceful shutdown on SIGTERM and SIGINT.
- ESLint (flat config) and Prettier. Vitest with a global setup that refuses non-`_test` databases, plus a table-truncation helper.
- 38 tests: config validation, logger and request ID, error handler, 404, `withTransaction` commit and rollback, and the health endpoint.

### Changed

- `.env.example`: `AUTH_SECRET` is now required, `LOG_LEVEL` was added, and the dev database moved to port 5434.

## [0.0.0] - 2026-11-17 (Milestone 0: scaffolding)

### Added

- GitHub repository, MIT license, and `main` branch.
- Root config: `.gitignore`, `.editorconfig`, `.nvmrc` (Node 26.13.1), `.env.example`.
- README skeleton, `CLAUDE.md`, and this changelog.
- Docs: `backlog.md`, `architecture.md` with a layer diagram, ADR 0001 (record decisions), and ADR 0002 (ES modules and Vitest).
- Empty folder tree for `server/` and `client/`.
- Pull request template.

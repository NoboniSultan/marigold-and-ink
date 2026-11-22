<p align="center">
  <img src="docs/assets/marigold-ink-logo.png" alt="Marigold & Ink logo" width="180" />
</p>

# Marigold & Ink

Marigold & Ink is a full-stack platform for selling handmade art: custom portrait commissions (digital, physical, and mixed-media) and a shop of ready-made pieces. The backend carries the weight. It moves every commission through an explicit state machine with a full audit trail, computes quotes on the server from configurable pricing rules, takes two-stage Stripe payments through webhooks that are safe to receive more than once, and keeps a transparent donation ledger.

**Giving model:** 25% of the item price of every order is donated to charity. Shipping and tax are excluded from the donation base. Each donation is recorded against the charity that was active when the payment succeeded, and it is adjusted or reversed if the order is refunded.

> Status: early development. See the feature list and [roadmap](#roadmap).

## Features

| Feature | Status |
| --- | --- |
| Project scaffold, docs, ADRs | Built |
| Server foundation (config, logging, errors, health check) | Built |
| Database schema and migrations | Built |
| Authentication and roles (sessions, ownership, rate limiting, CSRF) | Built |
| CI (GitHub Actions) and deployment (API on Render, Postgres on Neon) | Built, live |
| Commission requests and state machine (audit trail, actor permissions, revision limit) | Built |
| Pricing engine and quotes (generate, admin adjustment, send) | Built, with **placeholder prices** |
| Public gallery API (search, filters, admin CRUD), image pipeline, About content | Built |
| Website: Home (typewriter, carousel), Gallery (grid and 3D), About, login, commission form | Built, with **placeholder copy** |
| Accounts: email sign-up verified by a 6-digit code, "Continue with Google" | Built; email sending and Google need [setup](docs/setup-google-and-email.md) |
| Stripe deposit and final payments, webhooks, refunds | Planned |
| Donation ledger and transparency totals | Planned |
| File uploads, messaging, shipping, shop, slots | Later (see backlog) |

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 26 LTS (ES modules); TypeScript run directly by Node (type stripping), checked by `tsc` |
| Images | Sharp, run locally by `npm run media` (WebP, metadata stripped) |
| API | Express 5 |
| Database | PostgreSQL 17 with the `pg` driver and raw parameterized SQL |
| Migrations | node-pg-migrate with plain `.sql` files |
| Validation | zod |
| Auth | Server sessions in Postgres (express-session + connect-pg-simple), httpOnly cookie |
| Security | helmet, cors allow-list, express-rate-limit, bcrypt, openid-client (Google OIDC) |
| Logging | pino with a request ID on every line |
| Cache / queue | Redis (BullMQ later) |
| Payments | Stripe Checkout and webhooks, test mode |
| Tests | Vitest and Supertest against a separate test database |
| Lint / format | ESLint and Prettier |
| Frontend | React 19, Vite, React Router, TanStack Query, CSS Modules, Motion, React Three Fiber (TypeScript) |
| Local infra | Docker Compose |
| CI | GitHub Actions |
| Hosting | API on Render (Blueprint in `render.yaml`); Postgres on Neon |

## Architecture

The backend is organized by feature module. Each module has strict layers: routes, then controller, then service, then repository. Third-party SDKs are wrapped in adapters. Pure domain logic (state machine, pricing, donation calculation) has no database or HTTP access, so it is unit tested directly.

See [docs/architecture.md](docs/architecture.md) for the layer diagram, request flow, and module map, and [docs/data-model.md](docs/data-model.md) for the database schema (ER diagram plus every constraint and index explained).

The database enforces the money rules as a backstop to the application. For example: deposit plus balance must equal the quoted total, a commission can be paid at most once per stage, each payment produces at most one donation, there is one active charity at a time, and the commission history is append-only.

## Folder structure

```
.github/          CI workflow and pull request template
docs/             proposal, architecture, data model, state machine, ADRs, backlog, TypeScript guide
content/          artworks.json and about.json: the owner-edited gallery and About content
media/            processed WebP images + manifest.json (written by npm run media; committed)
media-source/     original photos (gitignored; only on the owner's machine)
shared/types/     API types shared by the server and the client (type-only)
server/scripts/   npm run media (image pipeline)
server/src/       Express API
  config/         validated environment config
  db/             pg pool, transaction helper, migrations, seeds
  middleware/     auth, validation, rate limiting, request ID, error handling
  errors/         AppError and its subclasses
  lib/            logger, money helpers, pagination
  adapters/       wrappers around outside services (email via Resend, Google sign-in)
  modules/        one folder per feature: routes, controller, service, repository, validation
server/tests/     test setup, factories, fixtures
client/src/       React site (TypeScript)
  api/            the only place fetch() is called; TanStack Query hooks
  auth/           AuthContext, RequireAuth
  components/     Header, Footer, Layout, ArtworkImage, forms
  content/        copy.ts: site text the owner writes (placeholders for now)
  features/       home (hero, carousel), gallery (grid, overlay, explore/ 3D), about
  hooks/          useTypewriter, useMediaQuery, useScrollLock
  pages/          one component per route
  styles/         tokens.css (palette, type, motion), global.css
```

## Local setup

**Prerequisites:** Node.js 26 (`nvm use` reads `.nvmrc`), Docker Desktop, Git.

```bash
git clone https://github.com/NoboniSultan/marigold-and-ink.git
cd marigold-and-ink
nvm use

# 1. Environment: copy the example, then set AUTH_SECRET and the admin account
cp .env.example .env
openssl rand -base64 48        # paste the output after AUTH_SECRET= in .env
                               # set ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters)

# 2. Infrastructure: dev Postgres (port 5434), test Postgres (5433), Redis (6379)
docker compose up -d --wait

# 3. Server
cd server
npm install
npm run migrate:up             # create the schema in the dev database
npm run seed                   # admin account, placeholder prices if none exist, gallery content
npm run dev                    # http://localhost:3000/api/v1/health

# 4. Website (second terminal)
cd client
npm install
npm run dev                    # http://localhost:5173 (proxies /api and /media to :3000)
```

The site and API share one origin in both development (Vite's proxy) and production (Express serves `client/dist`), so the session cookie works without CORS. `CORS_ORIGINS` in `.env` must include `http://localhost:5173` for logins and forms to pass the CSRF check. Vite uses `strictPort`: if another app already uses 5173, stop it or run `npx vite --port 5174` and add that origin to `CORS_ORIGINS`.

**Signing up locally:** sign-up emails a 6-digit code. In development no email is sent: the code is printed in the server terminal (`email (log transport, development only)`). To try Google sign-in locally, follow the [setup guide](docs/setup-google-and-email.md) and set `PUBLIC_URL=http://localhost:5173`.

### Site text and design

- Text the owner writes lives in [`client/src/content/copy.ts`](client/src/content/copy.ts): the typewriter lines, the main button, and the footer's charity line. Everything starting with `PLACEHOLDER` is waiting for real copy.
- The palette, fonts, spacing, and motion timing are CSS variables in [`client/src/styles/tokens.css`](client/src/styles/tokens.css).
- Every animation, with its reduced-motion fallback, is described in [docs/motion.md](docs/motion.md).

### Database migrations

Migrations are plain SQL files in `server/src/db/migrations/`. Each has an `-- Up Migration` and a `-- Down Migration` section. The schema is documented in [docs/data-model.md](docs/data-model.md).

```bash
npm run migrate:up                     # apply all pending migrations
npm run migrate:down                   # revert the most recent one
npm run migrate:down -- all            # revert everything
npm run migrate:create -- add-thing    # new timestamped .sql file to fill in
```

The test database is migrated automatically before every test run. Run one server test suite at a time: every test empties the shared test database first, so two runs at once (say, a watch session and a full run) wipe each other's data and fail at random. Within one run, test files already run one after another.

The server validates its environment at startup. If a variable is missing or invalid, it lists every problem and exits instead of starting half-configured.

The dev database uses host port **5434**, not the default 5432, so it does not clash with a Postgres already installed on your machine (Postgres.app, Homebrew).

`npm run seed` is idempotent: it creates the admin, or promotes an existing account with that email, and never overwrites an existing password. It also syncs `content/artworks.json` into the database (see below).

## Adding and editing artwork

Originals stay on your machine; only processed images and the text are committed.

1. Copy photos into `media-source/artworks/` (or `media-source/about/` for the About photo). JPEG, PNG, WebP, and HEIC all work; HEIC needs macOS.
2. From `server/`, run `npm run media`. It writes two WebP sizes per photo to `media/` (600px thumbnail, 2000px large), removes all photo metadata (including GPS location), and skips photos that haven't changed. Each new photo gets an entry in `content/artworks.json` with `"published": false` and `"to fill in"` placeholders.
3. Edit `content/artworks.json`: set `title`, `slug` (the URL), `category`, `medium`, and optionally `year`, `credit`, `description`, `altText`, and `tags`. Set `"published": true` when it's ready. The order of entries is the gallery order.
4. Run `npm run seed` to check it locally, then commit `media/` and `content/` and open a PR.

The seed refuses to run, and the deploy with it, if anything doesn't add up: a photo without an entry, an entry without a photo, a published entry still saying "to fill in", or a duplicate slug. It prints every problem at once. CI runs the same checks.

Editing an entry in the file always wins on the next deploy. Edits made through the admin API stay until you change that artwork in the file. To remove an artwork, delete its photo from `media-source/`, run `npm run media`, and delete its entry. See [ADR 0007](docs/decisions/0007-content-files-and-media-pipeline.md).

The About page reads `content/about.json`: `photo` (an image key from `media-source/about`, e.g. `artist-with-flowers`), `photoAlt`, `bio` paragraphs, and an optional `closingPhoto` + `closingPhotoAlt` shown at the bottom of the page. Lines starting with `PLACEHOLDER:` are still to be written.

## Running tests

Tests need the test database container (`docker compose up -d db-test`). They refuse to run against any database whose name does not end in `_test`.

```bash
cd server
npm test                # run once
npm run test:watch      # re-run on change
npm run test:coverage   # coverage summary in the terminal; HTML report in server/coverage/index.html
npm run lint            # ESLint
npm run format:check    # Prettier
npm run typecheck       # TypeScript (tsc, no output files)

cd ../client
npm test                # Vitest + Testing Library (page smoke tests, typewriter, 3D layout, API client)
npm run lint && npm run typecheck && npm run build
```

Tests use small fixture content and images in `server/tests/fixtures/`, so they never depend on the real photos; one test validates the real `content/` and `media/` separately.

CI runs two jobs on every pull request:

- **Server:** lint, format check, type check, migrations, and tests with coverage, then it seeds and boots the server under plain Node as Render does, against a throwaway Postgres 17 service.
- **Client:** lint, format check, type check, tests, and a production build.

`main` is protected: changes land only through a pull request, and both checks must pass first.

## Testing Stripe webhooks locally

> Added in milestone 7.

## API overview

All routes are under `/api/v1`. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details" } }`.

Every response carries an `X-Request-Id` header. Send your own (letters, digits, `.`, `_`, `-`, up to 128 characters) to trace a request through the logs.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | Public | App status and a database ping. Returns 200, or 503 if the database is unreachable. |
| POST | `/api/v1/auth/signup/start` | Public | Sign-up step 1: `{ email }`. Emails a 6-digit code (an existing member gets an "already have an account" email instead; the answer is the same). 202. One code a minute per address; 5 requests per hour per IP. |
| POST | `/api/v1/auth/signup/complete` | Public | Sign-up step 2: `email`, `code`, `password` (12+ chars, ≤ 72 bytes), `displayName`. Creates the verified account and logs in. A code works for 15 minutes and 5 tries. |
| GET | `/api/v1/auth/google/start` | Public | Browser navigation: starts Google sign-in (`?next=/path` to return to). |
| GET | `/api/v1/auth/google/callback` | Public | Where Google sends the visitor back; signs in and redirects to `next`, or to `/login?error=…`. |
| GET | `/api/v1/auth/providers` | Public | `{ google, emailSignup }`: which sign-in methods are switched on. |
| POST | `/api/v1/auth/login` | Public | Log in. Body: `email`, `password`. Rate limited: 10 failed attempts per 15 minutes per IP + email. Accounts never verified get 403 `EMAIL_NOT_VERIFIED` (only with the right password). |
| POST | `/api/v1/auth/logout` | Any | End the session (idempotent). Returns 204. |
| GET | `/api/v1/auth/session` | Public | Who is logged in: `{ data: user }` or `{ data: null }`, always 200 (the site asks on every page load). |
| GET | `/api/v1/users/me` | Logged in | The current user. |
| GET | `/api/v1/users/:id` | Owner or admin | A user record. Clients may only read their own. |
| GET | `/api/v1/users` | Admin | Paginated list of users (`?page=1&pageSize=20`, max 100). |
| POST | `/api/v1/commissions` | Client | Request a commission: `size`, `medium`, `subjectCount`, `fulfillmentType`, `isRush`, `notes`. Starts at `inquiry`. Price fields are ignored. 422 if the size + medium isn't offered. |
| GET | `/api/v1/commissions` | Logged in | Clients see their own; admins see all. `?status=&page=&pageSize=` |
| GET | `/api/v1/commissions/:id` | Owner or admin | The commission plus `availableTransitions` for the current user. |
| POST | `/api/v1/commissions/:id/transitions` | Owner or admin | Change status: `{ toStatus, reason? }`. Rules in [docs/state-machine.md](docs/state-machine.md). |
| GET | `/api/v1/commissions/:id/events` | Owner or admin | Full status history: who, when, from → to, why. |
| POST | `/api/v1/commissions/:id/quote` | Admin | Generate a draft quote from the active pricing rules (inquiry only). |
| PATCH | `/api/v1/commissions/:id/quote` | Admin | Adjust the draft: `{ adjustedAmountCents, adjustmentNote }` (note required). |
| POST | `/api/v1/commissions/:id/quote/send` | Admin | Send the draft: stores total, deposit, and balance on the commission and moves it to `quoted`, all in one transaction. |
| GET | `/api/v1/commissions/:id/quote` | Owner or admin | The current quote. Clients only see it once it has been sent. |
| GET | `/api/v1/artworks` | Public | Published artworks in gallery order. `?page=&pageSize=&category=&tag=&q=`. `q` is full-text search (`"exact phrase"`, `-exclude`), ranked by relevance. |
| GET | `/api/v1/artworks/categories` | Public | Categories with their published-artwork counts. |
| GET | `/api/v1/artworks/:slug` | Public | One published artwork. Drafts answer 404, like missing artworks. |
| GET | `/api/v1/tags` | Public | Tags used by published artworks, with counts. |
| GET | `/api/v1/about` | Public | The About page photo and bio. |
| GET | `/api/v1/admin/artworks` | Admin | All artworks, including drafts. `?status=all\|published\|draft` plus the public filters. |
| GET | `/api/v1/admin/artworks/:id` | Admin | One artwork with admin fields (`isPublished`, `contentManaged`, ...). |
| POST | `/api/v1/admin/artworks` | Admin | Create from a processed image: `imageKey`, `slug`, `title`, `category`, optional fields, `tags` (names). |
| PATCH | `/api/v1/admin/artworks/:id` | Admin | Edit any field; `tags` replaces the list. Publishing requires alt text. |
| DELETE | `/api/v1/admin/artworks/:id` | Admin | Delete. 409 for artworks owned by `content/artworks.json`. |
| GET / POST | `/api/v1/admin/tags` | Admin | List all tags with counts / create (`name`, optional `slug`). |
| PATCH / DELETE | `/api/v1/admin/tags/:id` | Admin | Rename / delete a tag. |
| GET | `/api/v1/pricing/options` | Public | What the commission form may offer: priced size + medium pairs, fulfillment types, extra subjects, rush. No prices. |

Images are served from `/media/artworks/...` and `/media/about/...` (paths come from the API), cached by browsers for a year.

**Commissions:** every status change goes through the state machine and is written together with an audit event in one transaction, with the commission row locked against concurrent changes. Who may make which change is documented in [docs/state-machine.md](docs/state-machine.md).

**Pricing:** quotes are computed on the server by a pure engine (`pricing.engine.ts`) from active `pricing_rules`: base price by size and medium, plus extra subjects, a fulfillment surcharge, and an optional flat rush fee, all in integer cents. The deposit is `DEPOSIT_PERCENT` of the total, rounded half up to the cent; the balance is the exact remainder.

> ⚠️ **Placeholder prices.** The current price list, `DEPOSIT_PERCENT=50`, and `COMMISSION_REVISION_LIMIT=2` are placeholders (see `server/src/db/seeds/pricing.placeholder.js`). The seed only inserts prices into an empty table, so real prices are never overwritten.

**Auth model:** server-side sessions stored in Postgres. The browser holds only a signed session ID in an `httpOnly`, `SameSite=Lax` cookie (`Secure` with the `__Host-` prefix in production). Sessions last 7 days from the last request. State-changing requests from an `Origin` outside `CORS_ORIGINS` are rejected as CSRF. Passwords are hashed with bcrypt (cost 12). See [ADR 0004](docs/decisions/0004-server-sessions-in-postgres.md).

**Accounts:** an account exists only once its owner has entered a code sent to the email (or signed in with Google, which verifies the email), so nobody can open an account with someone else's address. Google sign-in uses the OpenID Connect code flow with PKCE, state, and nonce, checks the ID token's signature and claims, and matches people by Google's permanent ID. Admin accounts can't use Google. See [ADR 0010](docs/decisions/0010-email-verification-and-google-sign-in.md) and the [setup guide](docs/setup-google-and-email.md).

Error codes used so far: `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `BAD_REQUEST` (any other malformed request body, usually 400), `UNAUTHENTICATED` / `INVALID_CREDENTIALS` (401), `FORBIDDEN` / `CSRF_ORIGIN_MISMATCH` / `EMAIL_NOT_VERIFIED` (403), `COMMISSION_TRANSITION_FORBIDDEN` (403), `NOT_FOUND` / `ROUTE_NOT_FOUND` / `USER_NOT_FOUND` / `COMMISSION_NOT_FOUND` / `QUOTE_NOT_FOUND` / `ARTWORK_NOT_FOUND` / `TAG_NOT_FOUND` / `ASSET_NOT_FOUND` (404), `CONFLICT` / `EMAIL_TAKEN` / `COMMISSION_INVALID_TRANSITION` / `QUOTE_NOT_ALLOWED` / `QUOTE_NOT_EDITABLE` / `SLUG_TAKEN` / `IMAGE_IN_USE` / `TAG_TAKEN` / `ARTWORK_CONTENT_MANAGED` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_ENCODING` (415), `BUSINESS_RULE_VIOLATION` / `REVISION_LIMIT_REACHED` / `UNSUPPORTED_SIZE_MEDIUM` / `PRICING_RULE_MISSING` / `PRICING_RULE_AMBIGUOUS` / `IMAGE_NOT_FOUND` / `ALT_TEXT_REQUIRED` / `INVALID_TAG` / `CODE_INCORRECT` / `CODE_EXPIRED` (422), `RATE_LIMITED` / `CODE_RESEND_TOO_SOON` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` / `EMAIL_SIGNUP_UNAVAILABLE` / `EMAIL_SEND_FAILED` (503).

## Deployment

**Live site and API:** https://marigold-and-ink-api.onrender.com. Health check: [`/api/v1/health`](https://marigold-and-ink-api.onrender.com/api/v1/health). On the free plan the service sleeps when idle, so the first request may take up to a minute.

The API runs on [Render](https://render.com), defined in [`render.yaml`](render.yaml) (a Render Blueprint). The Postgres 17 database runs on [Neon](https://neon.com)'s free plan, in the same region (Oregon). See [ADR 0005](docs/decisions/0005-hosting-on-render.md) and [ADR 0006](docs/decisions/0006-neon-for-production-postgres.md).

- **Deploys:** Render deploys `main` automatically, but only after GitHub Actions CI passes (`autoDeployTrigger: checksPass`).
- **Build:** `cd client && npm ci --include=dev && npm run build && cd ../server && npm ci --omit=dev`. Express serves the built site from `client/dist`; the site and API share one URL. (`NODE_ENV=production` would make a plain `npm ci` skip Vite and TypeScript, hence `--include=dev` for the client.)
- **On start:** `cd server && npm run migrate:up && npm run seed && npm start`. A failed migration, or content that doesn't match its images, means the new instance never passes its health check (`/api/v1/health`), so the previous deploy keeps serving.
- **No `rootDir`:** Render hides files outside a service's root directory, and the server reads `content/` and `media/` at the repo root, so the commands `cd server` themselves.
- **Environment variables:**

  | Variable | Source |
  | --- | --- |
  | `NODE_ENV`, `NODE_VERSION`, `TRUST_PROXY` | Fixed values in `render.yaml` |
  | `AUTH_SECRET` | Generated by Render |
  | `DATABASE_URL`, `CORS_ORIGINS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Entered in the Render Dashboard when the Blueprint is created; never committed |
  | `PUBLIC_URL` | Fixed in `render.yaml` (the site's address; Google returns visitors there) |
  | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM` | Optional, added in the Render Dashboard; each feature stays off until set. See the [setup guide](docs/setup-google-and-email.md) |

- **Database connection:** use Neon's **direct** connection string (connection pooling off, so the host has no `-pooler`), with `sslmode=verify-full`. The migration tool takes a lock that Neon's pooled connections can't hold. TLS verifies Neon's certificate, and `channel_binding=require` is honored (see `server/src/db/connection.js`).
- **Free plan limits:** the API sleeps after 15 minutes idle, so the first request then takes a while. The Neon database sleeps after 5 minutes idle (it wakes in under a second), is limited to 1 GB, and keeps only 6 hours of restore history. Move to plans with real backups before real customers use the site.

**First-time setup:**
1. In Neon, create a project (Postgres 17, AWS US West / Oregon) and copy the direct connection string. Change `sslmode=require` to `sslmode=verify-full`.
2. In the Render Dashboard, choose New → Blueprint, then connect this repository.
3. Enter values for `DATABASE_URL`, `CORS_ORIGINS` (the service's own URL: the site is served from it), `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
4. Apply, then check `https://<service>.onrender.com/api/v1/health`.

## Design decisions

Architecture Decision Records live in [docs/decisions/](docs/decisions/):

- [0001: Record architecture decisions](docs/decisions/0001-record-architecture-decisions.md)
- [0002: ES modules and Vitest](docs/decisions/0002-es-modules-and-vitest.md)
- [0003: Database migrations and schema conventions](docs/decisions/0003-database-schema-conventions.md)
- [0004: Authentication with server-side sessions stored in Postgres](docs/decisions/0004-server-sessions-in-postgres.md)
- [0005: Host on Render, defined as a Blueprint](docs/decisions/0005-hosting-on-render.md)
- [0006: Host the production database on Neon](docs/decisions/0006-neon-for-production-postgres.md)
- [0007: Artwork content in files, images processed locally and committed](docs/decisions/0007-content-files-and-media-pipeline.md)
- [0008: TypeScript on the server through Node's type stripping](docs/decisions/0008-typescript-with-node-type-stripping.md)
- [0009: React client: same origin, CSS Modules, TanStack Query](docs/decisions/0009-react-client-stack.md)
- [0010: Email-verified sign-up and Google sign-in](docs/decisions/0010-email-verification-and-google-sign-in.md)

## Roadmap

Planned and deferred work is tracked in [docs/backlog.md](docs/backlog.md). The full product vision is in [docs/proposal.md](docs/proposal.md).

## License

The source code is released under the [MIT License](LICENSE). The artwork, photographs, and the Marigold & Ink name and logo are **not** covered by that license. All rights are reserved.

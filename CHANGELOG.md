# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one entry per milestone.

## [Unreleased]

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

# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one entry per milestone.

## [Unreleased]

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

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
| Database schema and migrations | Planned |
| Authentication and roles | Planned |
| CI and deployment | Planned |
| Commission state machine | Planned |
| Pricing engine and quotes | Planned |
| Public gallery API and React client | Planned |
| Stripe deposit and final payments, webhooks, refunds | Planned |
| Donation ledger and transparency totals | Planned |
| File uploads, messaging, shipping, shop, slots | Later (see backlog) |

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 26 LTS (ES modules) |
| API | Express 5 |
| Database | PostgreSQL 17 with the `pg` driver and raw parameterized SQL |
| Migrations | SQL-first migration tool (chosen in milestone 2) |
| Validation | zod |
| Auth | Chosen in milestone 3 (see ADRs) |
| Security | helmet, cors allow-list, express-rate-limit, bcrypt |
| Logging | pino with a request ID on every line |
| Cache / queue | Redis (BullMQ later) |
| Payments | Stripe Checkout and webhooks, test mode |
| Tests | Vitest and Supertest against a separate test database |
| Lint / format | ESLint and Prettier |
| Frontend | React, Vite, React Router |
| Local infra | Docker Compose |
| CI | GitHub Actions |
| Hosting | Chosen in milestone 3 |

## Architecture

The backend is organized by feature module. Each module has strict layers: routes, then controller, then service, then repository. Third-party SDKs are wrapped in adapters. Pure domain logic (state machine, pricing, donation calculation) has no database or HTTP access, so it is unit tested directly.

See [docs/architecture.md](docs/architecture.md) for the layer diagram, request flow, and module map.

## Folder structure

```
.github/          CI workflow and pull request template
docs/             proposal, architecture, data model, state machine, ADRs, backlog
server/src/       Express API
  config/         validated environment config
  db/             pg pool, transaction helper, migrations, seeds
  middleware/     auth, validation, rate limiting, request ID, error handling
  errors/         AppError and its subclasses
  lib/            logger, money helpers, pagination
  adapters/       wrappers around third-party SDKs (Stripe)
  modules/        one folder per feature: routes, controller, service, repository, validation
server/tests/     test setup, factories, fixtures
client/src/       React app: api layer, components, pages, hooks, design tokens
```

## Local setup

**Prerequisites:** Node.js 26 (`nvm use` reads `.nvmrc`), Docker Desktop, Git.

```bash
git clone https://github.com/NoboniSultan/marigold-and-ink.git
cd marigold-and-ink
nvm use

# 1. Environment: copy the example and set AUTH_SECRET
cp .env.example .env
openssl rand -base64 48        # paste the output after AUTH_SECRET= in .env

# 2. Infrastructure: dev Postgres (port 5434), test Postgres (5433), Redis (6379)
docker compose up -d --wait

# 3. Server
cd server
npm install
npm run dev                    # http://localhost:3000/api/v1/health
```

The server validates its environment at startup. If a variable is missing or invalid, it lists every problem and exits instead of starting half-configured.

The dev database uses host port **5434**, not the default 5432, so it does not clash with a Postgres already installed on your machine (Postgres.app, Homebrew).

Migrations, seeds, and the client are added in later milestones.

## Running tests

Tests need the test database container (`docker compose up -d db-test`). They refuse to run against any database whose name does not end in `_test`.

```bash
cd server
npm test                # run once
npm run test:watch      # re-run on change
npm run test:coverage   # coverage summary in the terminal; HTML report in server/coverage/index.html
npm run lint            # ESLint
npm run format:check    # Prettier
```

## Testing Stripe webhooks locally

> Added in milestone 7.

## API overview

All routes are under `/api/v1`. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details" } }`.

Every response carries an `X-Request-Id` header. Send your own (letters, digits, `.`, `_`, `-`, up to 128 characters) to trace a request through the logs.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | Public | App status and a database ping. Returns 200, or 503 if the database is unreachable. |

Error codes used so far: `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` / `ROUTE_NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `BUSINESS_RULE_VIOLATION` (422), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503).

## Deployment

> Added in milestone 3, including the live URL.

## Design decisions

Architecture Decision Records live in [docs/decisions/](docs/decisions/):

- [0001: Record architecture decisions](docs/decisions/0001-record-architecture-decisions.md)
- [0002: ES modules and Vitest](docs/decisions/0002-es-modules-and-vitest.md)

## Roadmap

Planned and deferred work is tracked in [docs/backlog.md](docs/backlog.md). The full product vision is in [docs/proposal.md](docs/proposal.md).

## License

The source code is released under the [MIT License](LICENSE). The artwork, photographs, and the Marigold & Ink name and logo are **not** covered by that license. All rights are reserved.

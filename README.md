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
| CI (GitHub Actions) and deployment config (Render) | Built; first deploy in progress |
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
| Migrations | node-pg-migrate with plain `.sql` files |
| Validation | zod |
| Auth | Server sessions in Postgres (express-session + connect-pg-simple), httpOnly cookie |
| Security | helmet, cors allow-list, express-rate-limit, bcrypt |
| Logging | pino with a request ID on every line |
| Cache / queue | Redis (BullMQ later) |
| Payments | Stripe Checkout and webhooks, test mode |
| Tests | Vitest and Supertest against a separate test database |
| Lint / format | ESLint and Prettier |
| Frontend | React, Vite, React Router |
| Local infra | Docker Compose |
| CI | GitHub Actions |
| Hosting | Render (Blueprint in `render.yaml`) |

## Architecture

The backend is organized by feature module. Each module has strict layers: routes, then controller, then service, then repository. Third-party SDKs are wrapped in adapters. Pure domain logic (state machine, pricing, donation calculation) has no database or HTTP access, so it is unit tested directly.

See [docs/architecture.md](docs/architecture.md) for the layer diagram, request flow, and module map, and [docs/data-model.md](docs/data-model.md) for the database schema (ER diagram plus every constraint and index explained).

The database enforces the money rules as a backstop to the application. For example: deposit plus balance must equal the quoted total, a commission can be paid at most once per stage, each payment produces at most one donation, there is one active charity at a time, and the commission history is append-only.

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
npm run seed                   # create the admin account from ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                    # http://localhost:3000/api/v1/health
```

### Database migrations

Migrations are plain SQL files in `server/src/db/migrations/`. Each has an `-- Up Migration` and a `-- Down Migration` section. The schema is documented in [docs/data-model.md](docs/data-model.md).

```bash
npm run migrate:up                     # apply all pending migrations
npm run migrate:down                   # revert the most recent one
npm run migrate:down -- all            # revert everything
npm run migrate:create -- add-thing    # new timestamped .sql file to fill in
```

The test database is migrated automatically before every test run.

The server validates its environment at startup. If a variable is missing or invalid, it lists every problem and exits instead of starting half-configured.

The dev database uses host port **5434**, not the default 5432, so it does not clash with a Postgres already installed on your machine (Postgres.app, Homebrew).

`npm run seed` is idempotent: it creates the admin, or promotes an existing account with that email, and never overwrites an existing password. The client is added in milestone 5.

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

CI runs the same steps on every pull request (lint, format check, migrations, tests with coverage) against a throwaway Postgres 17 service. `main` is protected: changes land only through a pull request, and the CI check must pass first.

## Testing Stripe webhooks locally

> Added in milestone 7.

## API overview

All routes are under `/api/v1`. Successful responses use `{ "data": ... }`; errors use `{ "error": { "code", "message", "details" } }`.

Every response carries an `X-Request-Id` header. Send your own (letters, digits, `.`, `_`, `-`, up to 128 characters) to trace a request through the logs.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | Public | App status and a database ping. Returns 200, or 503 if the database is unreachable. |
| POST | `/api/v1/auth/register` | Public | Create a client account and log in. Body: `email`, `password` (12+ chars, ≤ 72 bytes), `displayName`. Rate limited: 5 per hour per IP. |
| POST | `/api/v1/auth/login` | Public | Log in. Body: `email`, `password`. Rate limited: 10 failed attempts per 15 minutes per IP + email. |
| POST | `/api/v1/auth/logout` | Any | End the session (idempotent). Returns 204. |
| GET | `/api/v1/users/me` | Logged in | The current user. |
| GET | `/api/v1/users/:id` | Owner or admin | A user record. Clients may only read their own. |
| GET | `/api/v1/users` | Admin | Paginated list of users (`?page=1&pageSize=20`, max 100). |

**Auth model:** server-side sessions stored in Postgres. The browser holds only a signed session ID in an `httpOnly`, `SameSite=Lax` cookie (`Secure` with the `__Host-` prefix in production). Sessions last 7 days from the last request. State-changing requests from an `Origin` outside `CORS_ORIGINS` are rejected as CSRF. Passwords are hashed with bcrypt (cost 12). See [ADR 0004](docs/decisions/0004-server-sessions-in-postgres.md).

Error codes used so far: `VALIDATION_ERROR` (400), `INVALID_JSON` (400), `UNAUTHENTICATED` / `INVALID_CREDENTIALS` (401), `FORBIDDEN` / `CSRF_ORIGIN_MISMATCH` (403), `NOT_FOUND` / `ROUTE_NOT_FOUND` / `USER_NOT_FOUND` (404), `CONFLICT` / `EMAIL_TAKEN` (409), `PAYLOAD_TOO_LARGE` (413), `BUSINESS_RULE_VIOLATION` (422), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `SERVICE_UNAVAILABLE` (503).

## Deployment

**Live API:** _pending first deploy_

The API and its Postgres database run on [Render](https://render.com), defined in [`render.yaml`](render.yaml) (a Render Blueprint). See [ADR 0005](docs/decisions/0005-hosting-on-render.md).

- **Deploys:** Render deploys `main` automatically, but only after GitHub Actions CI passes (`autoDeployTrigger: checksPass`).
- **On start:** `npm run migrate:up && npm run seed && npm start`. A failed migration means the new instance never passes its health check (`/api/v1/health`), so the previous deploy keeps serving.
- **Environment variables:**

  | Variable | Source |
  | --- | --- |
  | `NODE_ENV`, `NODE_VERSION`, `TRUST_PROXY` | Fixed values in `render.yaml` |
  | `DATABASE_URL` | Render's private connection string to the database |
  | `AUTH_SECRET` | Generated by Render |
  | `CORS_ORIGINS`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Entered in the Render Dashboard when the Blueprint is created; never committed |

- **Free plan limits:** the service sleeps after 15 minutes idle (the first request then takes a while), and the free database expires after 30 days and has no backups. Upgrade the database before real customers use the site.

**First-time setup:**
1. In the Render Dashboard, choose New → Blueprint, then connect this repository.
2. Enter values for `CORS_ORIGINS` (the service's own URL until the client exists), `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
3. Apply, then check `https://<service>.onrender.com/api/v1/health`.

## Design decisions

Architecture Decision Records live in [docs/decisions/](docs/decisions/):

- [0001: Record architecture decisions](docs/decisions/0001-record-architecture-decisions.md)
- [0002: ES modules and Vitest](docs/decisions/0002-es-modules-and-vitest.md)
- [0003: Database migrations and schema conventions](docs/decisions/0003-database-schema-conventions.md)
- [0004: Authentication with server-side sessions stored in Postgres](docs/decisions/0004-server-sessions-in-postgres.md)
- [0005: Host on Render, defined as a Blueprint](docs/decisions/0005-hosting-on-render.md)

## Roadmap

Planned and deferred work is tracked in [docs/backlog.md](docs/backlog.md). The full product vision is in [docs/proposal.md](docs/proposal.md).

## License

The source code is released under the [MIT License](LICENSE). The artwork, photographs, and the Marigold & Ink name and logo are **not** covered by that license. All rights are reserved.

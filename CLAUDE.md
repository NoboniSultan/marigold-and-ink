# CLAUDE.md

Guidance for Claude Code sessions working on Marigold & Ink. Read `docs/proposal.md` for the product, `docs/architecture.md` for the design, and `docs/decisions/` for past decisions.

## Working agreement

1. **Plan before code.** At the start of each milestone, list the files to create or change, the decisions involved, and the open questions. Wait for the owner's reply before writing code.
2. **Ask, don't assume.** For choices that affect architecture, data, money, security, or anything the owner must explain in an interview, give 2 or 3 options with a one-line trade-off each and a recommendation. Never invent business values (prices, limits, charity names, brand colors, copy).
3. **Explain as you go.** Say briefly why for anything non-obvious. Explain each pattern in two or three sentences the first time it appears.
4. **Small, reviewable steps.** Make small commits. Show a new folder structure before creating many files.
5. **Milestone gate.** Run lint and the full test suite and show the results (including coverage). Update the README and `CHANGELOG.md`. Summarize what was built, what was tested, and what is open. Commit, push, and open a PR. Then **stop and wait for approval**.
6. **Stay in scope.** Put ideas for later in `docs/backlog.md` instead of building them.
7. **Never commit secrets.** Real values live only in `.env` (gitignored). Stripe stays in test mode.
8. **On failure,** show the error, explain the likely cause, and propose a fix before applying anything large.

## Stack

Node.js 26 LTS with **ES modules** (`"type": "module"`), Express, PostgreSQL via `pg` with raw parameterized SQL, zod, pino, Redis, Stripe (test mode), **Vitest** and Supertest, ESLint and Prettier, React with Vite and React Router. See ADR 0002 for why ESM and Vitest.

**TypeScript** (ADR 0008, `docs/typescript-guide.md`): new code is `.ts`, run directly by Node's type stripping (no build) and checked by `npm run typecheck` (CI). Import with the real extension (`./x.ts`), write type-only imports as `import type`, and use no `enum`/`namespace`/parameter properties. API types shared with the client live in `shared/types/` and are imported only as `import type ... from '@shared/...'`. Check responses with `satisfies ApiResponse<T>`. Leave the four conversions listed in the TypeScript guide for the owner.

## Layer rules (enforce these and flag any violation)

- **Routes** wire URLs to middleware and controller methods. No logic.
- **Controllers** translate HTTP to and from service calls. No SQL, no business rules, and no catching errors just to re-send them; errors go to the central error handler.
- **Services** hold business rules and orchestrate repositories and adapters. They never touch `req`/`res` and never write SQL.
- **Repositories** are the only place SQL lives. Every query is parameterized. Every function accepts an optional `client` so a service can run several calls in one transaction.
- **Adapters** (`server/src/adapters/`) are the only place third-party SDKs are imported. Services receive adapters through **dependency injection**, so tests pass fakes instead of mocking modules.
- **Pure domain logic** (state machine, pricing, donation calculation) is standalone functions with no DB or HTTP access.
- A module may call another module's **service**, never its repository.
- **Money is always integer cents.** Use the helpers in `server/src/lib/money.js`.

## API conventions

- All routes are under `/api/v1`.
- Success: `{ "data": ... }`. Lists: `{ "data": [...], "meta": { "page", "pageSize", "total" } }`.
- Error: `{ "error": { "code": "SCREAMING_SNAKE_CODE", "message": "...", "details": ... } }`.
- Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict or invalid state, 422 business rule, 429 rate limited.
- Never leak stack traces or SQL errors in production responses.

## Naming and Git

- Files: camelCase with a layer suffix, such as `gallery.service.ts` or `commissions.stateMachine.ts`. Tests go in the module's `__tests__/` as `*.test.ts` (older ones are `*.test.js`).
- Database: snake_case plural tables, `id` primary keys, `created_at`/`updated_at` as `timestamptz`.
- Branches: `feature/m<N>-<short-name>`. Commits: Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`, `refactor:`). One PR per milestone, using the template.
- ADRs: `docs/decisions/NNNN-title.md` in Nygard format (Context, Decision, Consequences).
- Changelog: Keep a Changelog format, with one entry per milestone.

## Testing standards

- Unit tests for pure logic. Integration tests use Supertest against `app.js` and a real **test** Postgres database (never the dev database), with tables truncated between tests.
- Use factories in `server/tests/factories/`, not copy-pasted inserts.
- Every endpoint gets at least: a happy path, a validation failure, an unauthenticated request, and a forbidden request where ownership or role applies.
- High branch-coverage thresholds apply to the state machine, pricing, payments, and donations modules.

## Commands

Run from `server/` unless noted.

```bash
nvm use                       # repo root; Node 26 from .nvmrc
docker compose up -d --wait   # repo root; dev db :5434, test db :5433, redis :6379
npm run dev                   # node --watch, loads ../.env
npm test                      # vitest run (needs db-test running)
npm run test:coverage
npm run lint
npm run format                # or format:check
npm run migrate:up            # dev database (NODE_ENV=test targets the test database)
npm run migrate:down          # revert last; `-- 3` or `-- all`
npm run migrate:create -- name
npm run seed                  # idempotent; admin from ADMIN_EMAIL/ADMIN_PASSWORD, placeholder prices, content sync
npm run typecheck             # tsc, no output
npm run media                 # process media-source/ into media/ (macOS for HEIC); add -- --force to redo all

# client/ (needs the API on :3000)
npm run dev                   # Vite on :5173, proxying /api and /media
npm test                      # Vitest + Testing Library
npm run lint && npm run typecheck && npm run build
```

## Git and GitHub rules

- `main` is protected: no direct pushes (admins included), no force-pushes. Changes land only through a PR, and the **"Server: lint, migrate, test"** and **"Client: lint, typecheck, test, build"** CI checks must pass with the branch up to date with `main`.
- Render deploys `main` only after CI passes (`render.yaml`, `autoDeployTrigger: checksPass`).
- The repo is public. Never put personal data (such as the admin email) or secrets in committed files; they belong in `.env` and Render's Dashboard.
- Stage explicit paths, never whole directories, and check `git diff --cached --name-only` before committing.

## Auth rules

- Protect routes with `requireAuth`, then `requireRole('admin')` or `requireOwnerOrAdmin(getOwnerId)`. In services, use `assertCanAccessOwnedResource(user, ownerId)` after loading a resource.
- Controllers read input only from `req.validated` (set by `validate({ params, query, body })`).
- Repositories select explicit column lists; only `usersRepository.findForAuthByEmail` returns `password_hash`.
- Accounts are created only by `auth.signup.service.ts` (after an emailed code) or `auth.google.service.ts` (Google-verified email); never insert a client user any other way. Google sign-in never applies to admins. See ADR 0010.
- Third-party services (email, Google) are adapters passed to `createApp({ adapters })`; tests pass fakes and never send email or call Google. The `log` email transport is development-only.
- Tests: `loggedInAgent(app, { role })` from `tests/helpers/auth.js` returns a logged-in Supertest agent; state-changing requests need `.set('Origin', TRUSTED_ORIGIN)`.

## Commission and money rules

- Change a commission's status **only** through `commissionsService.applyTransition(...)`. It locks the row, checks the state machine, updates, and writes the event in one transaction. Pass `{ client }` to join an existing transaction. Never `UPDATE commissions SET status` anywhere else.
- Transitions with `via` (`quote`, `refund`) belong to a dedicated flow; the generic status endpoint can't trigger them.
- To change the lifecycle, edit `TRANSITIONS` in `commissions.stateMachine.ts` **and** the independent `EXPECTED` table in its test, then update `docs/state-machine.md`.
- Prices come only from `pricing.engine.ts` + active `pricing_rules`; never trust amounts from a request. Use `lib/money.js` for all arithmetic (`percentOfCents`, `splitDeposit`, `sumCents`).
- `DEPOSIT_PERCENT` and `COMMISSION_REVISION_LIMIT` are owner-set business values with no code defaults. The current values (50, 2) and the seeded prices are **placeholders**.
- The state machine, pricing engine, and money helpers have 100% coverage thresholds; `npm run test:coverage` fails below them.

## Gallery, content, and media rules (ADR 0007)

- `content/artworks.json` is the source of truth for the artworks it lists. The seed syncs them by per-row `content_hash`: changed entries overwrite, unchanged ones keep admin edits. Never write artwork rows from the file any other way.
- Images come only from `npm run media` (originals in the gitignored `media-source/`; output in the committed `media/`). Never commit originals, and never add metadata-preserving options to the pipeline (it strips GPS).
- Never invent artwork titles, mediums, years, credits, alt text, or bio text. Unknown values stay `"to fill in"` (unpublished) or `PLACEHOLDER:`.
- Admin routes go on the `/api/v1/admin` router, which is guarded once at the router level (`routes.js`).
- Tests use `tests/fixtures/content` and `tests/fixtures/media` (set via `CONTENT_DIR` / `MEDIA_DIR` in `vitest.config.js`); `content.real.test.ts` checks the real files.

## Client rules (ADR 0009, docs/motion.md)

- Only `client/src/api/client.ts` calls `fetch`; components use the hooks in `api/queries.ts`. Types come from `shared/types` (`import type`).
- Style with CSS Modules and the variables in `styles/tokens.css`; never hard-code palette values. Marigold is never text on white; primary buttons are Marigold with Ink text.
- Every animation needs a reduced-motion fallback (`usePrefersReducedMotion`) and an entry in `docs/motion.md`.
- Site copy lives in `client/src/content/copy.ts`; never invent it (use `PLACEHOLDER:`).
- Page tests run with animations skipped; shared-layout exits and WebGL can't run in jsdom, so check them in a real browser and list that in the PR.

## Database rules

- Schema changes only through new migration files (never edit an applied migration). Write both up and down; the migration test reverts and re-applies all of them.
- Follow ADR 0003: bigint identity IDs, `citext` email, `text` + named `CHECK` (domains for shared lists), integer `_cents` money, `timestamptz`, an `updated_at` trigger on every mutable table, `ON DELETE RESTRICT` for anything tied to money or history.
- Name every constraint and index; add a constraint test in `src/db/__tests__/constraints.test.js` and document it in `docs/data-model.md`.

## Implementation notes

- `app.js` builds the app (`createApp()`); `server.js` only listens and handles shutdown. Tests import `createApp`.
- Throw `AppError` subclasses from `server/src/errors/`; never build error responses by hand. Express 5 forwards async errors to the error handler, so no try/catch or wrapper is needed in controllers.
- Log with `logger` from `lib/logger.js`; the request ID is added automatically (AsyncLocalStorage). Never use `console`.
- Integration tests that write data call `beforeEach(truncateAllTables)` from `tests/setup/database.js`, and create rows with the factories in `tests/factories/`.
- To simulate a database failure in a test, use `vi.spyOn(pool, 'query')`.

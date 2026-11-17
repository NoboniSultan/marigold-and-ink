# Architecture

This document describes how the backend is organized and how a request flows through it. It grows as milestones land.

## Layers

The server is organized **by feature module** (auth, users, gallery, commissions, pricing, payments, donations). Each module has the same strict layers. Every layer has a single job, so each one can be understood and tested on its own.

```mermaid
flowchart TD
    Client([HTTP client]) --> MW[Global middleware<br/>helmet · cors · requestId · body parser]
    MW --> Routes[Routes<br/>URL + middleware + controller method]
    Routes --> RouteMW[Route middleware<br/>requireAuth · requireRole · validate · rateLimit]
    RouteMW --> Controller[Controller<br/>reads req, calls service, sends res]
    Controller --> Service[Service<br/>business rules, orchestration, transactions]
    Service --> Domain[Pure domain logic<br/>state machine · pricing · donation calc]
    Service --> Repo[Repository<br/>parameterized SQL only]
    Service --> Adapter[Adapter<br/>wraps third-party SDKs]
    Repo --> DB[(PostgreSQL)]
    Adapter --> Ext[Stripe, later storage, shipping, email]
    Controller -. errors thrown .-> EH[Central error handler<br/>maps AppError to the JSON error shape]
    Service -. errors thrown .-> EH
```

| Layer | Allowed to | Never |
| --- | --- | --- |
| Routes | Map URLs to middleware and controller methods | Contain logic |
| Controller | Read `req`, call a service, send `res` | Write SQL, apply business rules, or catch errors just to re-send them |
| Service | Apply business rules, call repositories, adapters, domain functions, and other modules' services | Touch `req`/`res`, write SQL, or import an SDK |
| Repository | Run parameterized SQL, optionally on a passed-in transaction `client` | Contain business rules |
| Adapter | Import and call a third-party SDK | Know about HTTP or the database |
| Domain logic | Compute results from plain inputs | Access the database, HTTP, or the clock implicitly |

### Why these rules

- **Repository pattern:** all SQL for a table lives in one module. Services ask for data ("find commission by id") without knowing how it is stored. That keeps SQL in one reviewable place and keeps business rules readable.
- **Adapters with dependency injection:** services receive adapters (such as the Stripe adapter) as arguments instead of importing an SDK. Tests can pass a fake, and switching providers only touches the adapter. See [ADR 0002](decisions/0002-es-modules-and-vitest.md).
- **Pure domain logic:** the rules most likely to cost money if wrong (state transitions, quotes, donations) are plain functions, so they get exhaustive unit tests.

## Request lifecycle

Global middleware runs in this order (see `server/src/app.js`):

1. **requestId**: reuses a safe incoming `X-Request-Id` or generates a UUID, sets the response header, and runs the rest of the request inside an AsyncLocalStorage context.
2. **requestLogger**: one log line per request when it finishes (method, path, status, duration).
3. **helmet**: security headers.
4. **cors**: only origins listed in `CORS_ORIGINS` get CORS headers.
5. **express.json**: parses JSON bodies up to 100 KB.
6. **/api/v1 routes**: feature modules.
7. **notFound**: anything unmatched becomes `404 ROUTE_NOT_FOUND`.
8. **errorHandler**: the only place errors become HTTP responses.

### Errors

Code at any layer throws an `AppError` subclass (`NotFoundError`, `ConflictError`, ...). Express 5 forwards both thrown errors and rejected promises to the error handler. The handler turns them into `{ "error": { "code", "message", "details" } }`. Any error that is not an `AppError` is a bug: the client gets a generic `500 INTERNAL_ERROR`, and the real error and stack trace go only to the logs.

### Logging and request IDs

`lib/logger.js` adds the current request ID to every log line through a pino mixin that reads AsyncLocalStorage. A service or repository can log without receiving `req`, and its lines still correlate with the request.

## Request flow (example)

To be expanded in milestone 4. For example, `POST /api/v1/commissions/:id/transitions` goes from route, through `requireAuth` and `validate`, to the controller, then to `commissions.service`. The service runs `withTransaction`: it loads the commission, calls `assertTransition`, updates the status, and inserts a `commission_events` row, then commits.

## Module map

| Module | Responsibility | Milestone |
| --- | --- | --- |
| health | `GET /health`: app status and a database ping | 1 |
| auth | register, login, logout, session/token handling | 3 |
| users | user profile, `GET /me` | 3 |
| commissions | requests, state machine, event history | 4 |
| pricing | pricing rules and the `calculateQuote` engine, quotes | 4 |
| gallery | artworks and tags, public listing | 5 |
| payments | Stripe Checkout sessions, webhooks, refunds | 7 |
| donations | donation calculator, ledger, charities, public totals | 8 |

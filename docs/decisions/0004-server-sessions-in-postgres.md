# 4. Authentication with server-side sessions stored in Postgres

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Clients and the admin log in from a browser. We need to know who is making each request, log users out reliably, and keep credentials away from page JavaScript. The app is a single API with one web client. No mobile app or third-party service consumes it.

Options considered:

1. **Server sessions in Postgres, httpOnly cookie.** The browser holds only a random, signed session ID. Session data lives in a `sessions` table.
2. **Server sessions in Redis.** Same model, with faster lookups, but a hosted Redis is needed from day one.
3. **JWT.** A short-lived access token plus a refresh token in a cookie. No server-side session storage, but logout and revocation need a denylist or a refresh-token table. Those are extra moving parts that only pay off with many services or non-browser clients.

## Decision

Use **express-session with the connect-pg-simple store**, keeping sessions in the existing Postgres. The `sessions` table is created by our own migration, not by the library.

- **Cookie:** `httpOnly`, `SameSite=Lax`, `Secure` in production, and the `__Host-` name prefix in production (Secure, Path=/, no Domain, so no subdomain can set or read it). Signed with `AUTH_SECRET`.
- **Lifetime:** 7 days of inactivity (`rolling: true`). Logout deletes the session row immediately.
- **Session fixation:** the session ID is regenerated on every login and registration.
- **Loading the user:** the session stores only `userId`. `requireAuth` re-reads the user from the database on each request, so role changes and deleted accounts take effect at once.
- **CSRF:** two layers. First, the `SameSite=Lax` cookie isn't sent on cross-site POSTs. Second, state-changing requests whose `Origin` (or `Referer`) isn't on the `CORS_ORIGINS` allow-list are rejected with `403 CSRF_ORIGIN_MISMATCH`.
- **Passwords:** bcrypt with cost 12 (configurable). The policy is a minimum of 12 characters and a maximum of 72 bytes, because bcrypt silently ignores anything past 72 bytes. Login responses are identical for an unknown email and a wrong password, and both take bcrypt-equal time thanks to a dummy hash.
- **Rate limiting:** login allows 10 *failed* attempts per IP + email per 15 minutes. Registration allows 5 per IP per hour. Both are configurable, and the counters are in memory.

## Consequences

- One request on each authenticated call loads the session and one loads the user. That's negligible at this scale and indexed by primary key.
- No Redis is needed in production yet.
- Cookies must be same-site. Browsers increasingly block cookies on cross-site requests, so the React client (milestone 5) must be served from the same site as the API: either by Express or through a rewrite to `/api`. This is decided in milestone 5.
- The in-memory rate-limit counters are per instance and reset on restart. Scaling beyond one instance needs a shared store (Redis); see the backlog.
- Revoking every session for a user ("log out everywhere") would need the user ID as a column. It's deferred until needed.

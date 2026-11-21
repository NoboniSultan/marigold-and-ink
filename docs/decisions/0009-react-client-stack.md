# 9. React client: same origin, CSS Modules, TanStack Query

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

Milestone 5b adds the public site. The owner chose:
- React in TypeScript from the start;
- hosting option A, Express serving the built site;
- a brand palette and fonts;
- an animation map with a 3D gallery.

Still to decide were styling, data fetching, and how the site reaches the API without weakening the session cookie.

## Decision

- **Vite, React 19, React Router 8, TypeScript.** The client reuses `shared/types` (type-only imports), and responses are typed end to end.
- **Same origin.** In production, Express serves `client/dist` (`server/src/lib/clientSite.ts`). In development, Vite proxies `/api` and `/media` to the API. Either way the browser sees one origin, so:
  - the `httpOnly`, `SameSite=Lax` session cookie works as is;
  - CORS isn't involved;
  - the CSRF origin check stays strict.
- **CSS Modules plus design tokens.** The palette, type, spacing and motion values are CSS custom properties in `styles/tokens.css`, and component styles are scoped `*.module.css` files.
  - Chosen over Tailwind: no second design vocabulary, no extra dependency, and the brand lives in one file.
- **TanStack Query over the `api/` layer.** `api/client.ts` is the only place that calls `fetch`. Query hooks add caching, loading and error states, and retries (never for 4xx).
  - Login, logout and register update the cached "current user", so the whole UI updates at once.
- **`GET /auth/session`** answers 200 with the user or `null`. A logged-out visitor is a normal state, not an error to log on every page load.
- **Motion** for animation. **React Three Fiber** for Explore mode, code-split with `React.lazy`, so three.js only downloads when someone opens it.
- **The strict CSP stays:** helmet's defaults, including `script-src 'self'`. Fonts are self-hosted (Fontsource) and nothing loads from a third party. This was verified in Chrome against the production build.

## Consequences

- **One deploy and one URL.** Render builds the client, then starts the API (`render.yaml`). Because Render sets `NODE_ENV=production`, the client install uses `--include=dev`.
- **Bundle size:**
  - The main bundle is about 168 KB gzipped (React DOM, Motion, React Router, TanStack Query).
  - Explore is about 285 KB gzipped, loaded on demand.
  - Motion's `LazyMotion` could trim the main bundle later (backlog).
- **Tests:** Vitest and Testing Library cover behavior with animations skipped. jsdom has no layout or WebGL, so the morph and 3D scene are checked in a real browser (PR checklist).

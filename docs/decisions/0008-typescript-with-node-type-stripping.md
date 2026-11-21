# 8. TypeScript on the server through Node's type stripping

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

The owner wants TypeScript: the React client from the start, and the server converted gradually, starting with the money-critical pure logic (state machine, pricing engine, donation calculation). API types should be shared between server and client.

Options for running TypeScript on the server:

1. **Compile with `tsc` to `dist/`.** A build step, source maps, and two copies of every file.
2. **A runtime loader such as `tsx`.** An extra dependency in production.
3. **Node's built-in type stripping.** Node 26 runs `.ts` files directly by erasing the type annotations. There is no build and no dependency.

## Decision

Option 3. `tsc` runs only as a type checker (`npm run typecheck`, `noEmit`), and CI runs it.

`server/tsconfig.json` enforces what type stripping needs:

- **`erasableSyntaxOnly`:** no `enum`, `namespace`, or constructor parameter properties, since these generate code. Use union types (`'client' | 'admin'`) instead.
- **`allowImportingTsExtensions`:** imports name the real file (`./x.ts`), because Node doesn't rewrite extensions.
- **`verbatimModuleSyntax`:** type-only imports are written `import type`, so they vanish at runtime.
- **`allowJs`:** existing `.js` files keep working and convert one at a time.

**Shared types** live in `shared/types/`, at the repo root. The server imports them through the alias `@shared/*` (tsconfig `paths`) with `import type` only. Node can't resolve the alias, which is safe only because type imports are erased. An ESLint rule rejects any value import from `@shared`.

The server checks its responses against the shared types with `satisfies`, e.g. `res.json({ data } satisfies ApiResponse<Artwork>)`.

## Consequences

- Production runs exactly the files in the repo, with no build artifacts to go stale.
- Type errors don't stop Node from running; only `npm run typecheck` (and CI) catches them.
- Tests run TypeScript through Vitest's own transform, so CI also boots the app under plain Node.
- See [docs/typescript-guide.md](../typescript-guide.md) for conventions and the files still to convert.

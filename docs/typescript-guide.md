# TypeScript guide

How TypeScript works in this repo, and four small conversions left for you to try. See [ADR 0008](decisions/0008-typescript-with-node-type-stripping.md) for why it's set up this way.

## How it runs

- **No build step.** Node 26 runs `.ts` files directly by erasing the types ("type stripping"). Production runs exactly the files in the repo.
- **Types are checked separately.** `npm run typecheck` (from `server/`) runs `tsc`, which checks without writing any files. CI runs it. Node itself never checks types, so code with a type error still runs locally; only the type check catches it.
- **Mixed JS and TS.** `.js` files still work (`allowJs`). A `.ts` file can import a `.js` file, and the reverse.

## Rules (enforced by `tsconfig.json` and ESLint)

| Rule | Why |
| --- | --- |
| Import with the real extension: `import { x } from './x.ts'` | Node doesn't rewrite `.js` to `.ts`. |
| Type-only imports use `import type { Artwork } from '...'` | They're removed at runtime. Without `type`, Node would try to load a module that only has types. |
| No `enum`, `namespace`, or `constructor(private x)` | They generate JavaScript, so they can't simply be erased. Use union types: `type Role = 'client' \| 'admin'`. |
| `@shared/*` only with `import type` | It's an alias only the type checker knows (`tsconfig` `paths`). An ESLint rule enforces it. |

## Patterns used so far

- **Types from data:** `const STATUSES = [...] as const; type CommissionStatus = (typeof STATUSES)[number]`. Here the list is the single source of truth and the type follows it (`commissions.stateMachine.ts`).
- **Discriminated unions:** `type Actor = { type: 'client' | 'admin'; userId: number } | { type: 'system' }`. After checking `actor.type`, TypeScript knows whether `userId` exists.
- **`satisfies`:** checks a value against a type without changing the value's own type.
  - In `commissions.stateMachine.ts`, the transition table `satisfies Transition[]`, so a typo like `'in_progres'` fails.
  - Controllers use `res.json({ data } satisfies ApiResponse<Artwork>)`, so a response that drifts from `shared/types` fails the type check.
- **zod as the source of types:** `type CreateArtworkInput = z.infer<typeof createArtworkBody>`. One definition validates at runtime *and* types the code.
- **Generics:** `withTransaction<T>(fn: (client) => Promise<T>): Promise<T>` returns whatever your callback returns (`db/transaction.ts`).
- **Declaration merging:** `src/types/express.d.ts` adds `req.validated` and `req.user` to Express's `Request` type.

## Your turn: four small conversions

Each one takes about 10–20 minutes. For each:
1. Rename with `git mv x.js x.ts`.
2. Update the importers' paths from `.js` to `.ts` (find them with `grep -rn "x.js" src tests`).
3. Add types.
4. Run `npm run typecheck && npm test`.

1. **`src/db/errors.js`** (easiest). `isUniqueViolation(err, constraint)` receives an unknown thrown value.
   - Type `err` as `unknown` and `constraint` as `string | undefined` (or optional).
   - You'll need to narrow `err` before reading `.code`. Try `typeof err === 'object' && err !== null && 'code' in err`.
   - Importers: `users.service.js`, `gallery.service.ts`.
2. **`src/lib/authorization.js`.**
   - Define a small user type: `{ id: number; role: 'client' | 'admin' }`.
   - Allow `null | undefined` for the user, since `canAccessOwnedResource` handles a missing one.
   - `ownerId: number`. Both functions return booleans or throw; `assertCanAccessOwnedResource` returns `void`.
   - Importers: `middleware/auth.js`, `commissions.service.js`.
3. **`src/lib/pagination.js`.**
   - Export `type Pagination = z.infer<typeof paginationQuery>`.
   - Type `toLimitOffset` to return `{ limit: number; offset: number }`.
   - Type `toPageMeta` to return `PageMeta`, imported with `import type` from `@shared/types/api.ts`. That links the server's pagination to the shared response type.
   - Importers: several services and validation files.
4. **`src/middleware/originCheck.js`** (Express types).
   - Import `type { RequestHandler } from 'express'`, and make `requireTrustedOrigin({ allowedOrigins }: { allowedOrigins: Iterable<string> })` return a `RequestHandler`.
   - `originFromReferer(referer: string | undefined): string | undefined`.
   - Importer: `app.js`.

A good check after each one: delete a type annotation, run `npm run typecheck`, and read the error. Learning to read those errors is most of the skill.

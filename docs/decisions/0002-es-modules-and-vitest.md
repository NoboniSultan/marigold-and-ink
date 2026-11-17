# 2. ES modules and Vitest

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

We need one module system for the whole codebase. The React client is built with Vite, which uses ES modules (`import`/`export`). The original stack named Jest as the test runner.

Jest's ES module support still needs an experimental Node flag, and its usual way of replacing a module in tests (`jest.mock`) does not work with ES modules. The workaround is `jest.unstable_mockModule`, which is still marked unstable. This matters most for the Stripe payment tests in milestone 7.

Options considered:

1. **ESM + Jest**: matches the original spec, but needs an experimental flag and an unstable mocking API.
2. **CommonJS + Jest**: works with no setup, but uses the older module style and is inconsistent with the client.
3. **ESM + Vitest**: Vitest supports ES modules natively. Its API is nearly identical to Jest's (`describe`, `it`, `expect`, `vi.fn`), and it works with Supertest. It changes the specified stack.

## Decision

Use **ES modules** everywhere (`"type": "module"` in `server/package.json`) and **Vitest** with Supertest for tests. The owner intends to run this project in production, so we prefer stable tooling over matching the original stack.

We also use **dependency injection** for adapters: services receive their adapters (such as Stripe) as arguments instead of importing them. Tests pass a fake adapter instead of mocking a module.

## Consequences

- No experimental flags. One module style across the server and client, and the client's Vite tooling shares Vitest's config style.
- Payment services can be tested without Stripe because they depend on an adapter interface, not on the SDK.
- The README and `CLAUDE.md` name Vitest instead of Jest. Coverage uses `@vitest/coverage-v8`, with thresholds set per folder in `vitest.config.js`.
- Contributors familiar with Jest can read the tests, though a few APIs differ (`vi` instead of `jest`).

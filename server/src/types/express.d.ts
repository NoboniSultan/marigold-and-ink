/**
 * Adds this app's request properties to Express's Request type ("declaration merging":
 * an interface declared twice is combined into one). Type-only; nothing runs.
 */
import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `validate()`: parsed params, query, and body. Controllers read only this. */
    validated: { params?: unknown; query?: unknown; body?: unknown };
    /** Set by `requireAuth`: the current user, re-read from the database. */
    user?: { id: number; email: string; role: 'client' | 'admin'; displayName: string | null };
  }
}

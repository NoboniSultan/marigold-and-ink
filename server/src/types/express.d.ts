/**
 * Adds this app's request and session properties to the library types ("declaration
 * merging": an interface declared twice is combined into one). Type-only; nothing runs.
 */
import 'express-serve-static-core';
import 'express-session';
import type { GoogleChecks } from '../adapters/googleOidc.ts';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `validate()`: parsed params, query, and body. Controllers read only this. */
    validated: { params?: unknown; query?: unknown; body?: unknown };
    /** Set by `requireAuth`: the current user, re-read from the database. */
    user?: { id: number; email: string; role: 'client' | 'admin'; displayName: string | null };
  }
}

declare module 'express-session' {
  interface SessionData {
    /** The logged-in user. The only thing a session holds once signed in. */
    userId: number;
    /** A Google sign-in in progress: the one-time checks and where to return afterwards. */
    googleSignIn: GoogleChecks & { next: string; startedAt: number };
  }
}

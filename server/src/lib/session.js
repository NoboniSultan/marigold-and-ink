import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { config } from '../config/env.js';
import { logger } from './logger.js';

const PgStore = connectPgSimple(session);

/**
 * Cookie name. In production the `__Host-` prefix makes browsers enforce that the
 * cookie is Secure, has Path=/, and has no Domain, so no subdomain can set or read it.
 * (Browsers reject `__Host-` cookies over plain HTTP, so local dev uses a plain name.)
 */
export const SESSION_COOKIE_NAME = config.isProduction ? '__Host-sid' : 'sid';

export const sessionCookieOptions = Object.freeze({
  httpOnly: true, // JavaScript in the page can't read it, so XSS can't steal the session
  secure: config.isProduction, // HTTPS only in production
  sameSite: 'lax', // not sent on cross-site POSTs: the first line of CSRF defense
  path: '/',
  maxAge: config.sessionMaxAgeMs,
});

/**
 * Server-side sessions stored in Postgres. The browser holds only a random, signed
 * session ID; the session data (the user ID) lives in the `sessions` table, so logging
 * out or revoking a session takes effect immediately.
 */
export function createSessionMiddleware({ pool }) {
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false, // the table is created by a migration
    // Delete expired rows every 15 minutes; off in tests so no timer keeps the process alive.
    pruneSessionInterval: config.isTest ? false : 15 * 60,
    errorLog: (...args) => logger.error({ args }, 'session store error'),
  });

  const middleware = session({
    name: SESSION_COOKIE_NAME,
    secret: config.authSecret,
    store,
    resave: false, // don't rewrite unchanged sessions on every request
    saveUninitialized: false, // no session row or cookie until someone logs in
    rolling: true, // each response pushes the expiry forward: 7 days of *inactivity*
    cookie: { ...sessionCookieOptions },
  });

  return { middleware, store };
}

// express-session's session methods take callbacks; these wrap them as promises.

export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

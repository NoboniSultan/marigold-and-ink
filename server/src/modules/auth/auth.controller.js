import * as authService from './auth.service.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  regenerateSession,
  saveSession,
  destroySession,
} from '../../lib/session.js';

/**
 * Starts a fresh session for `user`. Regenerating the session ID on login prevents
 * session fixation: an ID planted in the browser before login is never upgraded
 * to a logged-in session.
 */
async function startSession(req, user) {
  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);
}

export async function register(req, res) {
  const user = await authService.register(req.validated.body);
  await startSession(req, user);
  res.status(201).json({ data: user });
}

export async function login(req, res) {
  const user = await authService.login(req.validated.body);
  await startSession(req, user);
  res.json({ data: user });
}

/** Idempotent: logging out without a session still succeeds. */
export async function logout(req, res) {
  await destroySession(req);
  const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions;
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
  res.status(204).end();
}

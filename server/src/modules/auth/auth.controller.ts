import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type { AuthProviders } from '@shared/types/user.ts';
import { config } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  regenerateSession,
  saveSession,
  destroySession,
} from '../../lib/session.js';
import type { AppAdapters } from '../../adapters/index.ts';
import * as authService from './auth.service.js';
import * as signupService from './auth.signup.service.ts';
import { GoogleSignInError, finishGoogleSignIn, startGoogleSignIn } from './auth.google.service.ts';

/** A Google sign-in must come back within this time. */
const GOOGLE_SIGN_IN_TTL_MS = 10 * 60_000;

/** The email and Google adapters, set once in createApp (tests pass fakes). */
const adapters = (req: Request) => req.app.locals.adapters as AppAdapters;

/**
 * Starts a fresh session for `user`. Regenerating the session ID on login prevents
 * session fixation: an ID planted in the browser before login is never upgraded
 * to a logged-in session.
 */
async function startSession(req: Request, user: { id: number }) {
  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);
}

/** Step 1 of sign-up: email a code. The answer is the same whether or not an account exists. */
export async function signupStart(req: Request, res: Response) {
  const { email } = req.validated.body as { email: string };
  const result = await signupService.startSignup({ email }, { emailSender: adapters(req).email });
  res.status(202).json({ data: { email, ...result } });
}

/** Step 2: check the code, create the (verified) account, and log in. */
export async function signupComplete(req: Request, res: Response) {
  const user = await signupService.completeSignup(
    req.validated.body as Parameters<typeof signupService.completeSignup>[0],
  );
  await startSession(req, user);
  res.status(201).json({ data: user });
}

export async function login(req: Request, res: Response) {
  const user = await authService.login(req.validated.body as { email: string; password: string });
  await startSession(req, user);
  res.json({ data: user });
}

/** Who is logged in: { data: user } or { data: null }. Always 200. */
export async function session(req: Request, res: Response) {
  res.json({ data: await authService.getSessionUser(req.session?.userId) });
}

/** Which sign-in methods are switched on, so the site shows only those. */
export function providers(req: Request, res: Response) {
  const { email, google } = adapters(req);
  res.json({
    data: { google: google !== null, emailSignup: email !== null },
  } satisfies ApiResponse<AuthProviders>);
}

/** Idempotent: logging out without a session still succeeds. */
export async function logout(req: Request, res: Response) {
  await destroySession(req);
  const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions;
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
  res.status(204).end();
}

// --- Google: the browser navigates to these two (full page loads, not fetch) ---

function redirectToLogin(res: Response, reason: string) {
  res.redirect(303, `/login?error=${encodeURIComponent(reason)}`);
}

/** Remembers the one-time checks in the session, then sends the visitor to Google. */
export async function googleStart(req: Request, res: Response) {
  const { next = '/' } = req.validated.query as { next?: string };
  try {
    const { url, checks } = await startGoogleSignIn(adapters(req).google);
    req.session.googleSignIn = { ...checks, next, startedAt: Date.now() };
    await saveSession(req);
    res.redirect(303, url);
  } catch (err) {
    if (!(err instanceof GoogleSignInError)) throw err;
    logger.warn({ err, reason: err.reason }, 'Google sign-in could not start');
    redirectToLogin(res, err.reason);
  }
}

/** Google sends the visitor back here with a one-time code (or an error). */
export async function googleCallback(req: Request, res: Response) {
  // One-time: the pending sign-in is removed whether or not this callback succeeds.
  const pending = req.session.googleSignIn;
  delete req.session.googleSignIn;
  const fresh = pending && Date.now() - pending.startedAt < GOOGLE_SIGN_IN_TTL_MS;

  // The URL Google redirected to, rebuilt from PUBLIC_URL so it matches the registered one
  // exactly, even behind Render's proxy.
  const callbackUrl = new URL(req.originalUrl, config.publicUrl ?? `${req.protocol}://${req.host}`);

  try {
    const user = await finishGoogleSignIn(
      adapters(req).google,
      callbackUrl,
      fresh ? pending : undefined,
    );
    await startSession(req, user);
    res.redirect(303, pending?.next ?? '/');
  } catch (err) {
    const reason = err instanceof GoogleSignInError ? err.reason : 'google_failed';
    logger.warn({ err, reason }, 'Google sign-in failed');
    // Persist the removal of the pending sign-in. With none pending there is nothing to
    // save, and saving would store an empty session row for every stray callback visit.
    if (pending) await saveSession(req);
    redirectToLogin(res, reason);
  }
}

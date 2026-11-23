import * as usersService from './users.service.ts';
import * as accountService from '../auth/auth.account.service.ts';
import { logger } from '../../lib/logger.js';
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  destroySession,
  regenerateSession,
  saveSession,
} from '../../lib/session.js';

/** The signed-in user (requireAuth loaded them onto req.user), with their sign-in methods. */
export async function getMe(req, res) {
  res.json({ data: await accountService.getAccount(req.user) });
}

export async function updateMe(req, res) {
  const user = await usersService.updateDisplayName(req.user.id, req.validated.body.displayName);
  res.json({ data: await accountService.getAccount(user) });
}

/** Every session was signed out; this browser gets a fresh one so it stays signed in. */
export async function changePassword(req, res) {
  await accountService.changePassword(req.user.id, req.validated.body);
  await regenerateSession(req);
  req.session.userId = req.user.id;
  await saveSession(req);
  res.status(204).end();
}

export async function deleteMe(req, res) {
  const canceled = await accountService.deleteAccount(req.user.id, req.validated.body);
  // As after any cancel: close the commissions' open Stripe pages. The deletion has
  // committed, so a failure here is logged, never reported as a failure.
  for (const commission of canceled) {
    try {
      await req.app.locals.onCommissionStatusChange?.(commission);
    } catch (err) {
      logger.warn({ err, commissionId: commission.id }, 'after-status-change step failed');
    }
  }
  await destroySession(req);
  const { maxAge: _maxAge, ...clearOptions } = sessionCookieOptions;
  res.clearCookie(SESSION_COOKIE_NAME, clearOptions);
  res.status(204).end();
}

export async function getById(req, res) {
  const user = await usersService.getById(req.validated.params.id);
  res.json({ data: user });
}

export async function list(req, res) {
  const { users, meta } = await usersService.listUsers(req.validated.query);
  res.json({ data: users, meta });
}

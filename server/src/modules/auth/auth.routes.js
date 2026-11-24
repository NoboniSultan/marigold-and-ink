import { Router } from 'express';
import * as authController from './auth.controller.ts';
import {
  signupStartBody,
  signupCompleteBody,
  loginBody,
  googleStartQuery,
  passwordResetStartBody,
  passwordResetCompleteBody,
} from './auth.validation.js';
import { validate } from '../../middleware/validate.js';
import { loginRateLimiter, registerRateLimiter } from '../../middleware/rateLimit.js';

export const authRouter = Router();

// Rate limiters run before validation, so malformed floods are throttled too.
// Sign-up step 1 sends an email, so it shares the registration limit (per IP); step 2 is
// a code guess, so it gets the login limiter (per IP + email) on top of the 5 tries a code allows.
authRouter.post(
  '/signup/start',
  registerRateLimiter,
  validate({ body: signupStartBody }),
  authController.signupStart,
);
authRouter.post(
  '/signup/complete',
  loginRateLimiter,
  validate({ body: signupCompleteBody }),
  authController.signupComplete,
);
authRouter.post('/login', loginRateLimiter, validate({ body: loginBody }), authController.login);
// Forgot password: the same limits as sign-up (step 1 sends an email; step 2 is a guess).
authRouter.post(
  '/password-reset/start',
  registerRateLimiter,
  validate({ body: passwordResetStartBody }),
  authController.passwordResetStart,
);
authRouter.post(
  '/password-reset/complete',
  loginRateLimiter,
  validate({ body: passwordResetCompleteBody }),
  authController.passwordResetComplete,
);
authRouter.post('/logout', authController.logout);
authRouter.get('/session', authController.session);
authRouter.get('/providers', authController.providers);

// Google: full-page navigations (the browser goes to Google and back), so plain GETs.
authRouter.get('/google/start', validate({ query: googleStartQuery }), authController.googleStart);
authRouter.get('/google/callback', authController.googleCallback);

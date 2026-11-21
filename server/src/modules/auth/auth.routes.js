import { Router } from 'express';
import * as authController from './auth.controller.js';
import { registerBody, loginBody } from './auth.validation.js';
import { validate } from '../../middleware/validate.js';
import { loginRateLimiter, registerRateLimiter } from '../../middleware/rateLimit.js';

export const authRouter = Router();

// Rate limiters run before validation, so malformed floods are throttled too.
authRouter.post(
  '/register',
  registerRateLimiter,
  validate({ body: registerBody }),
  authController.register,
);
authRouter.post('/login', loginRateLimiter, validate({ body: loginBody }), authController.login);
authRouter.post('/logout', authController.logout);
authRouter.get('/session', authController.session);

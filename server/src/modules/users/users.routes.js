import { Router } from 'express';
import * as usersController from './users.controller.js';
import {
  changePasswordBody,
  deleteAccountBody,
  listUsersQuery,
  updateProfileBody,
  userIdParams,
} from './users.validation.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole, requireOwnerOrAdmin } from '../../middleware/auth.js';
import { passwordConfirmRateLimiter } from '../../middleware/rateLimit.js';

export const usersRouter = Router();

usersRouter.get(
  '/',
  requireAuth,
  requireRole('admin'),
  validate({ query: listUsersQuery }),
  usersController.list,
);

// The signed-in user's own account. Registered before '/:id' so "me" isn't treated as an ID.
usersRouter.get('/me', requireAuth, usersController.getMe);
usersRouter.patch(
  '/me',
  requireAuth,
  validate({ body: updateProfileBody }),
  usersController.updateMe,
);
usersRouter.post(
  '/me/password',
  requireAuth,
  passwordConfirmRateLimiter,
  validate({ body: changePasswordBody }),
  usersController.changePassword,
);
usersRouter.delete(
  '/me',
  requireAuth,
  passwordConfirmRateLimiter,
  validate({ body: deleteAccountBody }),
  usersController.deleteMe,
);

usersRouter.get(
  '/:id',
  requireAuth,
  validate({ params: userIdParams }),
  requireOwnerOrAdmin((req) => req.validated.params.id),
  usersController.getById,
);

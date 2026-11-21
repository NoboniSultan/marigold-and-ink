import { Router } from 'express';
import * as usersController from './users.controller.js';
import { listUsersQuery, userIdParams } from './users.validation.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole, requireOwnerOrAdmin } from '../../middleware/auth.js';

export const usersRouter = Router();

usersRouter.get(
  '/',
  requireAuth,
  requireRole('admin'),
  validate({ query: listUsersQuery }),
  usersController.list,
);

// Registered before '/:id' so "me" isn't treated as an ID.
usersRouter.get('/me', requireAuth, usersController.getMe);

usersRouter.get(
  '/:id',
  requireAuth,
  validate({ params: userIdParams }),
  requireOwnerOrAdmin((req) => req.validated.params.id),
  usersController.getById,
);

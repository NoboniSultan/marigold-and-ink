import { Router } from 'express';
import * as commissionsController from './commissions.controller.js';
import {
  commissionIdParams,
  createCommissionBody,
  listCommissionsQuery,
  changeStatusBody,
} from './commissions.validation.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

export const commissionsRouter = Router();

// Every commission route needs a logged-in user. Ownership is checked in the service,
// after the commission is loaded, because only then is its owner known.
commissionsRouter.use(requireAuth);

commissionsRouter.post(
  '/',
  requireRole('client'),
  validate({ body: createCommissionBody }),
  commissionsController.create,
);
commissionsRouter.get('/', validate({ query: listCommissionsQuery }), commissionsController.list);
commissionsRouter.get(
  '/:id',
  validate({ params: commissionIdParams }),
  commissionsController.getById,
);
commissionsRouter.post(
  '/:id/transitions',
  validate({ params: commissionIdParams, body: changeStatusBody }),
  commissionsController.changeStatus,
);
commissionsRouter.get(
  '/:id/events',
  validate({ params: commissionIdParams }),
  commissionsController.listEvents,
);

import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { commissionIdParams, listCommissionsQuery } from '../commissions/commissions.validation.js';
import * as adminController from './admin.controller.ts';

/** Mounted on the admin router (admin only) at /admin/commissions. */
export const adminCommissionsRouter = Router();

adminCommissionsRouter.get(
  '/',
  validate({ query: listCommissionsQuery }),
  adminController.listCommissions,
);
adminCommissionsRouter.get(
  '/:id',
  validate({ params: commissionIdParams }),
  adminController.getCommission,
);

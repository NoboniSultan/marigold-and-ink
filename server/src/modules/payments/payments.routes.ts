import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as paymentsController from './payments.controller.ts';
import { checkoutParams, commissionParams, refundBody } from './payments.validation.ts';

// Mounted at /commissions/:id/payments. mergeParams exposes the parent's :id here.
export const paymentsRouter = Router({ mergeParams: true });

paymentsRouter.use(requireAuth);
paymentsRouter.get('/', validate({ params: commissionParams }), paymentsController.list);
// The commission's own client pays: /deposit while quoted, /final while awaiting final payment.
paymentsRouter.post(
  '/:type',
  validate({ params: checkoutParams }),
  paymentsController.startCheckout,
);

// Mounted at /admin/commissions/:id/refunds, behind the admin router's guard.
export const adminRefundsRouter = Router({ mergeParams: true });

adminRefundsRouter.post(
  '/',
  validate({ params: commissionParams, body: refundBody }),
  paymentsController.refund,
);

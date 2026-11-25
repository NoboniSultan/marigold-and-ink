import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as shippingController from './shipping.controller.ts';
import { addressBody, chooseBody, commissionParams, packageBody } from './shipping.validation.ts';

/** Mounted at /commissions/:id/shipping: the commission's own client, or the admin. */
export const shippingRouter = Router({ mergeParams: true });
shippingRouter.use(requireAuth);

shippingRouter.get('/', validate({ params: commissionParams }), shippingController.get);
shippingRouter.put(
  '/address',
  validate({ params: commissionParams, body: addressBody }),
  shippingController.setAddress,
);
// POST: fetching prices records a new quote (and forgets the earlier choice).
shippingRouter.post('/options', validate({ params: commissionParams }), shippingController.quote);
shippingRouter.put(
  '/choice',
  validate({ params: commissionParams, body: chooseBody }),
  shippingController.choose,
);

/** Mounted on the admin router (admin only) at /admin/commissions/:id/shipping. */
export const adminShippingRouter = Router({ mergeParams: true });

adminShippingRouter.put(
  '/package',
  validate({ params: commissionParams, body: packageBody }),
  shippingController.setPackage,
);

import { Router } from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ordersController from './orders.controller.ts';
import {
  adminOrdersQuery,
  cartBody,
  myOrdersQuery,
  orderParams,
  refundBody,
} from './orders.validation.ts';

/** Mounted at /cart: prices a cart (public once the shop is open; the admin before). */
export const cartRouter = Router();
cartRouter.post('/preview', optionalAuth, validate({ body: cartBody }), ordersController.preview);

/** Mounted at /orders: checkout, and the logged-in client's own orders. */
export const ordersRouter = Router();
ordersRouter.use(requireAuth);
ordersRouter.post('/', validate({ body: cartBody }), ordersController.checkout);
ordersRouter.get('/', validate({ query: myOrdersQuery }), ordersController.mine);
ordersRouter.get('/:id', validate({ params: orderParams }), ordersController.get);

/** Mounted on the admin router (admin only) at /admin/orders. */
export const adminOrdersRouter = Router();
adminOrdersRouter.get('/', validate({ query: adminOrdersQuery }), ordersController.adminList);
adminOrdersRouter.get('/:id', validate({ params: orderParams }), ordersController.adminGet);
adminOrdersRouter.post(
  '/:id/refund',
  validate({ params: orderParams, body: refundBody }),
  ordersController.refund,
);

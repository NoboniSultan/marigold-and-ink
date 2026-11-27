import { Router } from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as ordersController from './orders.controller.ts';
import {
  adminOrdersQuery,
  cartBody,
  checkoutBody,
  labelBody,
  markBody,
  myOrdersQuery,
  orderParams,
  refundBody,
  shippingOptionsBody,
} from './orders.validation.ts';

/** Mounted at /cart: prices a cart (public once the shop is open; the admin before). */
export const cartRouter = Router();
cartRouter.post('/preview', optionalAuth, validate({ body: cartBody }), ordersController.preview);
// Live shipping options need an account (checkout does too), so prices aren't fetched for
// anyone who asks.
cartRouter.post(
  '/shipping-options',
  requireAuth,
  validate({ body: shippingOptionsBody }),
  ordersController.shippingOptions,
);

/** Mounted at /orders: checkout, and the logged-in client's own orders. */
export const ordersRouter = Router();
ordersRouter.use(requireAuth);
ordersRouter.post('/', validate({ body: checkoutBody }), ordersController.checkout);
ordersRouter.get('/', validate({ query: myOrdersQuery }), ordersController.mine);
// Registered before '/:id' so "address" isn't read as an order ID.
ordersRouter.get('/address', ordersController.lastAddress);
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

// Shipping an order (milestone 12c): marking it by hand, and its label and tracking.
adminOrdersRouter.post(
  '/:id/status',
  validate({ params: orderParams, body: markBody }),
  ordersController.mark,
);
adminOrdersRouter.post(
  '/:id/shipping/label-options',
  validate({ params: orderParams }),
  ordersController.labelOptions,
);
adminOrdersRouter.post(
  '/:id/shipping/label',
  validate({ params: orderParams, body: labelBody }),
  ordersController.buyLabel,
);
adminOrdersRouter.get(
  '/:id/shipping/label/file',
  validate({ params: orderParams }),
  ordersController.labelFile,
);
adminOrdersRouter.post(
  '/:id/shipping/label/void',
  validate({ params: orderParams }),
  ordersController.voidLabel,
);
adminOrdersRouter.post(
  '/:id/shipping/tracking/refresh',
  validate({ params: orderParams }),
  ordersController.refreshTracking,
);

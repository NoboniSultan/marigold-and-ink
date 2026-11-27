import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as shippingController from './shipping.controller.ts';
import type { NextFunction, Request, Response } from 'express';
import type { AppAdapters } from '../../adapters/index.ts';
import { checkWebhookToken } from './shipping.tracking.service.ts';
import {
  addressBody,
  chooseBody,
  commissionParams,
  labelBody,
  packageBody,
  webhookBody,
  webhookQuery,
} from './shipping.validation.ts';

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

// Labels and tracking (milestone 11b). POST: each asks the shipping service and records
// something (new prices, a bought or voided label, fresh tracking).
adminShippingRouter.post(
  '/label-options',
  validate({ params: commissionParams }),
  shippingController.labelOptions,
);
adminShippingRouter.post(
  '/label',
  validate({ params: commissionParams, body: labelBody }),
  shippingController.buyLabel,
);
adminShippingRouter.get(
  '/label/file',
  validate({ params: commissionParams }),
  shippingController.labelFile,
);
adminShippingRouter.post(
  '/label/void',
  validate({ params: commissionParams }),
  shippingController.voidLabel,
);
adminShippingRouter.post(
  '/tracking/refresh',
  validate({ params: commissionParams }),
  shippingController.refreshTracking,
);

/** Checks the webhook link's secret before anything else is looked at. */
function requireWebhookToken(req: Request, _res: Response, next: NextFunction) {
  const token = (req.validated.query as { token?: string }).token;
  checkWebhookToken(token, (req.app.locals.adapters as AppAdapters).shipping);
  next();
}

/**
 * Shippo's tracking webhook, mounted by app.js at /api/v1/webhooks/shippo, outside the
 * session and Origin checks (Shippo isn't a browser). The secret in the link proves it
 * came from the webhook set up in Shippo; even so, only the tracking number is used, and
 * the tracking itself is read back from Shippo.
 */
export const shippoWebhookRouter = Router();
shippoWebhookRouter.post(
  '/',
  validate({ query: webhookQuery }),
  requireWebhookToken,
  validate({ body: webhookBody }),
  shippingController.webhook,
);

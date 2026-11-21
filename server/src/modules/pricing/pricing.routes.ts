import { Router } from 'express';
import * as pricingController from './pricing.controller.ts';

export const pricingRouter = Router();

// Public: what can be requested (no prices), for the commission form.
pricingRouter.get('/options', pricingController.getOptions);

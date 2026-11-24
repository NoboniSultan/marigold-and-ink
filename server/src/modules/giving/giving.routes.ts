import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { donationsQuery, markDonationsPaidBody } from './giving.validation.ts';
import * as givingController from './giving.controller.ts';

export const givingRouter = Router();

// Public: the Giving page's running total.
givingRouter.get('/', givingController.totals);

/** Mounted on the admin router (admin only) at /admin/donations. */
export const adminDonationsRouter = Router();

adminDonationsRouter.get('/', validate({ query: donationsQuery }), givingController.listDonations);
adminDonationsRouter.post(
  '/mark-paid',
  validate({ body: markDonationsPaidBody }),
  givingController.markPaid,
);

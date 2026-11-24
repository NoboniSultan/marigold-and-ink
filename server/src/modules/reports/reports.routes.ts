import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as reportsController from './reports.controller.ts';
import { monthlyReportQuery } from './reports.validation.ts';

/** Mounted on the admin router (admin only) at /admin/reports. */
export const adminReportsRouter = Router();

adminReportsRouter.get(
  '/monthly',
  validate({ query: monthlyReportQuery }),
  reportsController.monthly,
);
adminReportsRouter.get(
  '/monthly.csv',
  validate({ query: monthlyReportQuery }),
  reportsController.monthlyCsv,
);

import { Router } from 'express';
import * as givingController from './giving.controller.ts';

export const givingRouter = Router();

// Public: the Giving page's running total.
givingRouter.get('/', givingController.totals);

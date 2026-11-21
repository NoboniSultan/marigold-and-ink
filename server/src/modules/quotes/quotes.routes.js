import { Router } from 'express';
import * as quotesController from './quotes.controller.js';
import { quoteParams, adjustQuoteBody } from './quotes.validation.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';

// Mounted at /commissions/:id/quote. mergeParams exposes the parent's :id here.
export const quotesRouter = Router({ mergeParams: true });

quotesRouter.use(requireAuth);

quotesRouter.get('/', validate({ params: quoteParams }), quotesController.get);
quotesRouter.post(
  '/',
  requireRole('admin'),
  validate({ params: quoteParams }),
  quotesController.generate,
);
quotesRouter.patch(
  '/',
  requireRole('admin'),
  validate({ params: quoteParams, body: adjustQuoteBody }),
  quotesController.adjust,
);
quotesRouter.post(
  '/send',
  requireRole('admin'),
  validate({ params: quoteParams }),
  quotesController.send,
);

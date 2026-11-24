import express, { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { uploadRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as filesController from './files.controller.ts';
import { commissionParams, fileParams } from './files.validation.ts';

/**
 * An upload is the file itself as the request body (any content type; the service checks
 * the real type from the bytes), capped a little above each kind's limit so the service
 * can answer with a clear message. express.raw only reads bodies for these routes.
 */
const rawUpload = (limit: string) => express.raw({ type: () => true, limit });

/** Mounted at /commissions/:id/files: the commission's own client, or the admin. */
export const filesRouter = Router({ mergeParams: true });
filesRouter.use(requireAuth);

filesRouter.get('/', validate({ params: commissionParams }), filesController.list);
filesRouter.post(
  '/references',
  uploadRateLimiter,
  rawUpload('16mb'),
  validate({ params: commissionParams }),
  filesController.uploadReference,
);
filesRouter.delete('/:fileId', validate({ params: fileParams }), filesController.remove);

/** Mounted on the admin router (admin only) at /admin/commissions/:id/files. */
export const adminFilesRouter = Router({ mergeParams: true });

adminFilesRouter.post(
  '/previews',
  uploadRateLimiter,
  rawUpload('26mb'),
  validate({ params: commissionParams }),
  filesController.uploadPreview,
);
adminFilesRouter.post(
  '/finals',
  uploadRateLimiter,
  rawUpload('101mb'),
  validate({ params: commissionParams }),
  filesController.uploadFinal,
);

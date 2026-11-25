import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { commissionsRouter } from './modules/commissions/commissions.routes.js';
import { quotesRouter } from './modules/quotes/quotes.routes.js';
import {
  artworksRouter,
  tagsRouter,
  adminArtworksRouter,
  adminTagsRouter,
} from './modules/gallery/gallery.routes.ts';
import { aboutRouter } from './modules/about/about.routes.ts';
import { pricingRouter } from './modules/pricing/pricing.routes.ts';
import { paymentsRouter, adminRefundsRouter } from './modules/payments/payments.routes.ts';
import { adminDonationsRouter, givingRouter } from './modules/giving/giving.routes.ts';
import { adminCommissionsRouter } from './modules/admin/admin.routes.ts';
import { adminReportsRouter } from './modules/reports/reports.routes.ts';
import { adminFilesRouter, filesRouter } from './modules/files/files.routes.ts';
import { adminShippingRouter, shippingRouter } from './modules/shipping/shipping.routes.ts';
import { requireAuth, requireRole } from './middleware/auth.js';

/** Mounts every module's router. app.js mounts this whole router under /api/v1. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
// The more specific /commissions/:id/... routers are mounted before /commissions.
apiRouter.use('/commissions/:id/quote', quotesRouter);
apiRouter.use('/commissions/:id/payments', paymentsRouter);
apiRouter.use('/commissions/:id/files', filesRouter);
apiRouter.use('/commissions/:id/shipping', shippingRouter);
apiRouter.use('/commissions', commissionsRouter);
apiRouter.use('/artworks', artworksRouter);
apiRouter.use('/tags', tagsRouter);
apiRouter.use('/about', aboutRouter);
apiRouter.use('/pricing', pricingRouter);
apiRouter.use('/giving', givingRouter);

// Admin-only routes share one guard at the router level, so a route added here later
// can't be left unprotected by forgetting requireRole on it.
const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));
adminRouter.use('/artworks', adminArtworksRouter);
adminRouter.use('/tags', adminTagsRouter);
adminRouter.use('/commissions/:id/refunds', adminRefundsRouter);
adminRouter.use('/commissions/:id/files', adminFilesRouter);
adminRouter.use('/commissions/:id/shipping', adminShippingRouter);
// After the refunds router: it owns POST /commissions/:id/refunds; this one only answers GETs.
adminRouter.use('/commissions', adminCommissionsRouter);
adminRouter.use('/donations', adminDonationsRouter);
adminRouter.use('/reports', adminReportsRouter);
apiRouter.use('/admin', adminRouter);

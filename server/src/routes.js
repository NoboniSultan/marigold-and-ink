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
import { requireAuth, requireRole } from './middleware/auth.js';

/** Mounts every module's router. app.js mounts this whole router under /api/v1. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
// The more specific /commissions/:id/quote is mounted before /commissions.
apiRouter.use('/commissions/:id/quote', quotesRouter);
apiRouter.use('/commissions', commissionsRouter);
apiRouter.use('/artworks', artworksRouter);
apiRouter.use('/tags', tagsRouter);
apiRouter.use('/about', aboutRouter);

// Admin-only routes share one guard at the router level, so a route added here later
// can't be left unprotected by forgetting requireRole on it.
const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));
adminRouter.use('/artworks', adminArtworksRouter);
adminRouter.use('/tags', adminTagsRouter);
apiRouter.use('/admin', adminRouter);

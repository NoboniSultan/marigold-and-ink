import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { commissionsRouter } from './modules/commissions/commissions.routes.js';
import { quotesRouter } from './modules/quotes/quotes.routes.js';

/** Mounts every module's router. app.js mounts this whole router under /api/v1. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
// The more specific /commissions/:id/quote is mounted before /commissions.
apiRouter.use('/commissions/:id/quote', quotesRouter);
apiRouter.use('/commissions', commissionsRouter);

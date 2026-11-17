import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.js';

/** Mounts every module's router. app.js mounts this whole router under /api/v1. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);

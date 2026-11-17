import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { apiRouter } from './routes.js';

/**
 * Builds the Express app without starting a server, so tests can drive it with
 * Supertest and server.js can own the network and process lifecycle.
 * Middleware order matters and is commented step by step.
 */
export function createApp() {
  const app = express();

  // 1. Tag the request with an ID first, so everything after it can log with that ID.
  app.use(requestId);
  app.use(requestLogger());

  // 2. Security headers, and only allow browser calls from known front-end origins.
  app.use(helmet());
  app.use(cors({ origin: [...config.corsOrigins] }));

  // 3. Parse JSON bodies, rejecting anything over 100 KB to limit abuse.
  //    (The Stripe webhook will need the raw body and is mounted before this in milestone 7.)
  app.use(express.json({ limit: '100kb' }));

  // 4. Feature routes.
  app.use('/api/v1', apiRouter);

  // 5. Nothing matched: 404. Then turn every error into the standard JSON shape.
  app.use(notFound);
  app.use(errorHandler());

  return app;
}

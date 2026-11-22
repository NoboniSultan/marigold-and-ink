import path from 'node:path';
import express from 'express';
import { CLIENT_DIST_DIR, MEDIA_DIR } from './config/paths.ts';
import { createClientSiteRouter } from './lib/clientSite.ts';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireTrustedOrigin } from './middleware/originCheck.js';
import { createSessionMiddleware } from './lib/session.js';
import { pool } from './db/pool.js';
import { apiRouter } from './routes.js';
import { createDefaultAdapters } from './adapters/index.ts';
import { stripeWebhook } from './modules/payments/payments.controller.ts';
import { expireOpenCheckouts } from './modules/payments/payments.service.ts';

const MEDIA_COLLECTIONS = ['artworks', 'about'];

/**
 * Builds the Express app without starting a server, so tests can drive it with
 * Supertest and server.js can own the network and process lifecycle.
 * Middleware order matters and is commented step by step.
 * The session store is exposed on app.locals so server.js can close it on shutdown.
 *
 * `adapters` are the third-party services (email, Google, Stripe). By default they're built
 * from config; tests pass fakes: createApp({ adapters: { email, google, payments } }).
 */
export function createApp({ adapters = createDefaultAdapters() } = {}) {
  const app = express();
  app.locals.adapters = adapters;
  // Runs after a status change through the generic endpoint. Wired here so the commissions
  // module needn't know about payments: a cancelled commission's open Stripe Checkout pages
  // are closed so they can't be paid.
  app.locals.onCommissionStatusChange = async (commission) => {
    if (commission.status === 'canceled') {
      await expireOpenCheckouts(commission.id, adapters.payments);
    }
  };

  // Behind Render's proxy, trust X-Forwarded-For/-Proto from that many hops, so req.ip
  // is the real client (rate limiting) and req.secure is true (Secure cookies).
  app.set('trust proxy', config.trustProxy);

  // 1. Tag the request with an ID first, so everything after it can log with that ID.
  app.use(requestId);
  app.use(requestLogger());

  // 2. Security headers, and only allow browser calls from known front-end origins.
  //    `credentials: true` lets those origins send the session cookie.
  app.use(helmet());
  app.use(cors({ origin: [...config.corsOrigins], credentials: true }));

  // 3. Processed images (npm run media). Before sessions, so an image never costs a session
  //    lookup. File names contain a content hash, so browsers may cache them forever
  //    (`immutable`): a changed image always gets a new name. Only the image folders are
  //    exposed, never media/manifest.json. A missing file falls through to the JSON 404.
  for (const collection of MEDIA_COLLECTIONS) {
    app.use(
      `/media/${collection}`,
      express.static(path.join(MEDIA_DIR, collection), {
        immutable: true,
        maxAge: '1y',
        index: false,
        redirect: false,
        dotfiles: 'ignore',
      }),
    );
  }

  //    The React site (client/dist), when built: its files, and index.html for page URLs.
  //    Also before sessions: serving the site never needs one. See lib/clientSite.ts.
  const clientSite = createClientSiteRouter(CLIENT_DIST_DIR);
  if (clientSite) app.use(clientSite);

  // 4. The Stripe webhook, before the JSON parser: its signature covers the exact bytes
  //    Stripe sent, so it needs the raw body. It also needs no session or Origin check:
  //    Stripe isn't a browser, and the signature proves where the request came from.
  app.post(
    '/api/v1/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    stripeWebhook,
  );

  //    Parse JSON bodies, rejecting anything over 100 KB to limit abuse.
  app.use(express.json({ limit: '100kb' }));

  // 5. Sessions (Postgres-backed, httpOnly cookie), then CSRF origin check for writes.
  const { middleware: sessionMiddleware, store: sessionStore } = createSessionMiddleware({ pool });
  app.locals.sessionStore = sessionStore;
  app.use(sessionMiddleware);
  app.use(requireTrustedOrigin({ allowedOrigins: config.corsOrigins }));

  // 6. Feature routes.
  app.use('/api/v1', apiRouter);

  // 7. Nothing matched: 404. Then turn every error into the standard JSON shape.
  app.use(notFound);
  app.use(errorHandler());

  return app;
}

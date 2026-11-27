import path from 'node:path';
import express from 'express';
import { CLIENT_DIST_DIR, MEDIA_DIR } from './config/paths.ts';
import { createClientSiteRouter } from './lib/clientSite.ts';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { canonicalHost } from './middleware/canonicalHost.ts';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireTrustedOrigin } from './middleware/originCheck.js';
import { createSessionMiddleware } from './lib/session.js';
import { pool } from './db/pool.js';
import { apiRouter } from './routes.js';
import { createDefaultAdapters } from './adapters/index.ts';
import { stripeWebhook } from './modules/payments/payments.controller.ts';
import { expireOpenCheckouts } from './modules/payments/payments.service.ts';
import { requestPendingTrees } from './modules/giving/giving.service.ts';
import { purgeExpiredFiles } from './modules/files/files.service.ts';
import { shippoWebhookRouter } from './modules/shipping/shipping.routes.ts';
import { shopPhotosRouter } from './modules/shop/shop.routes.ts';
import { releaseExpiredOrders } from './modules/orders/orders.service.ts';
import {
  notifyStatusChange,
  refreshAllTracking,
} from './modules/shipping/shipping.tracking.service.ts';

const MEDIA_COLLECTIONS = ['artworks', 'about'];

/**
 * Builds the Express app without starting a server, so tests can drive it with
 * Supertest and server.js can own the network and process lifecycle.
 * Middleware order matters and is commented step by step.
 * The session store is exposed on app.locals so server.js can close it on shutdown.
 *
 * `adapters` are the third-party services (email, Google, Stripe). By default they're built
 * from config; tests pass fakes: createApp({ adapters: { email, google, payments } }).
 *
 * `canonicalUrl` is the one address the site answers page requests on (others redirect
 * there). It's PUBLIC_URL in production only: in development PUBLIC_URL is the Vite site,
 * not the API's own address.
 *
 * `fileOrigin` is the R2 bucket's own address, where signed links to commission images
 * point (ADR 0016); the Content-Security-Policy lets pages show images from there only.
 */
export function createApp({
  adapters = createDefaultAdapters(),
  // The share of a fully paid commission that goes to trees; null = giving is off.
  donationPercent = config.giving?.donationPercent ?? null,
  // The shop (ADR 0019): closed (admin-only preview) until SHOP_OPEN=true.
  shopOpen = config.shopOpen,
  canonicalUrl = config.nodeEnv === 'production' ? config.publicUrl : null,
  fileOrigin = config.files
    ? `https://${config.files.bucket}.${config.files.accountId}.r2.cloudflarestorage.com`
    : null,
} = {}) {
  const app = express();
  app.locals.adapters = adapters;
  app.locals.donationPercent = donationPercent;
  app.locals.shopOpen = shopOpen;
  // Runs after a status change through the generic endpoint. Wired here so the commissions
  // module needn't know about payments: a cancelled commission's open Stripe Checkout pages
  // are closed so they can't be paid.
  // Sends pending tree requests to Digital Humani (after a payment, and at startup). Kept
  // here so the payments module needn't know about the trees adapter. Never throws.
  app.locals.requestPendingTrees = () => requestPendingTrees(adapters.trees);
  // What delivering a shop order needs (milestone 12d): the share, and the tree request.
  app.locals.giving = Object.freeze({
    donationPercent,
    requestTrees: app.locals.requestPendingTrees,
  });
  // Deletes files whose keeping period is over (ADR 0016); server.js runs it daily.
  app.locals.purgeExpiredFiles = () => purgeExpiredFiles(adapters.storage);
  // Checks every package still on its way, and pending label refunds (milestone 11b);
  // server.js runs it at startup and daily, as a backup to Shippo's tracking webhook.
  app.locals.refreshTracking = () =>
    refreshAllTracking({
      shipping: adapters.shipping,
      email: adapters.email,
      giving: app.locals.giving,
    });
  // Settles shop orders whose Stripe page closed without a webhook reaching us (asks Stripe);
  // server.js runs it at startup and every few minutes. Never throws.
  app.locals.releaseExpiredOrders = () =>
    releaseExpiredOrders({ gateway: adapters.payments, email: adapters.email });
  app.locals.onCommissionStatusChange = async (commission) => {
    if (commission.status === 'canceled') {
      await expireOpenCheckouts(commission.id, adapters.payments);
    }
    // The owner marked a package shipped or delivered by hand: the client hears about it as
    // they would from tracking.
    await notifyStatusChange(commission, adapters.email);
  };

  // Behind Render's proxy, trust X-Forwarded-For/-Proto from that many hops, so req.ip
  // is the real client (rate limiting) and req.secure is true (Secure cookies).
  app.set('trust proxy', config.trustProxy);

  // 1. Tag the request with an ID first, so everything after it can log with that ID.
  app.use(requestId);
  app.use(requestLogger());

  //    Page requests on another address (onrender.com, www.) go to the public one, where
  //    sign-in works. The Stripe webhook and health check are exempt (see the middleware).
  if (canonicalUrl) app.use(canonicalHost(canonicalUrl));

  // 2. Security headers, and only allow browser calls from known front-end origins.
  //    `credentials: true` lets those origins send the session cookie.
  //    Helmet's default Content-Security-Policy, plus images from the file bucket (signed
  //    links to reference photos and previews), and nothing else from elsewhere.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'img-src': ["'self'", 'data:', ...(fileOrigin ? [fileOrigin] : [])],
        },
      },
    }),
  );
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

  //    Shop product photos: kept in the private file bucket, served from here (ADR 0019).
  //    Their names contain a content hash, so they're cached forever too.
  app.use('/media/shop/products', shopPhotosRouter);

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

  //    Shippo's tracking webhook: also no session or Origin check (Shippo isn't a browser).
  //    A secret in its link is checked instead; see shipping.routes.ts. Tracking updates
  //    carry the package's whole history, hence the larger limit.
  app.use('/api/v1/webhooks/shippo', express.json({ limit: '1mb' }), shippoWebhookRouter);

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

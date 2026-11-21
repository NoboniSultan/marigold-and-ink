/**
 * Serves the built React site from the same origin as the API (milestone 5 decision A):
 * the session cookie needs no CORS, and Render runs one service.
 *
 * - /assets/*: Vite's content-hashed files, cached for a year (`immutable`).
 * - other public files (logo, favicon): cached for a day.
 * - any other GET that wants HTML gets index.html, so client-side routes such as
 *   /gallery/fawn work on reload. index.html is never cached, so a deploy shows at once.
 * - /api and /media are never answered with the site, so a missing API route still gets
 *   the JSON 404.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { NotFoundError } from '../errors/index.js';

const NOT_THE_SITE = /^\/(api|media)(\/|$)/;

export function createClientSiteRouter(distDir: string): Router | null {
  const indexFile = path.join(distDir, 'index.html');
  if (!existsSync(indexFile)) return null;

  const router = express.Router();

  router.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), { immutable: true, maxAge: '1y', index: false }),
    // A missing hashed asset (e.g. from an old deploy) is a real 404, never index.html:
    // sending HTML where a script was expected would fail in a confusing way.
    (_req: Request, _res: Response, next: NextFunction) => {
      next(new NotFoundError('Asset not found', { code: 'ASSET_NOT_FOUND' }));
    },
  );
  router.use(express.static(distDir, { index: false, maxAge: '1d', dotfiles: 'ignore' }));

  router.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    if (NOT_THE_SITE.test(req.path) || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  return router;
}

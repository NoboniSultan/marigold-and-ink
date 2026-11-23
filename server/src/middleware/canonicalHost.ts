/**
 * Sends visitors on any other address (the onrender.com one, www.) to the site's public
 * address, keeping the path and query. Sign-in only works there: Google returns to
 * PUBLIC_URL, and the session cookie belongs to that one host.
 *
 * - Only GET and HEAD are redirected. Other methods pass through: a form posted from a tab
 *   opened on the old address still gets an answer (its origin is in CORS_ORIGINS).
 * - The Stripe webhook and the health check answer on every address: Stripe doesn't follow
 *   redirects, and Render's health check may not use the public address.
 */
import type { NextFunction, Request, Response } from 'express';

function isExempt(path: string): boolean {
  return path === '/api/v1/health' || path.startsWith('/api/v1/webhooks/');
}

export function canonicalHost(publicUrl: string) {
  const { hostname, origin } = new URL(publicUrl);

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.hostname === hostname || isExempt(req.path)) return next();
    // Concatenated, never resolved with new URL(): a path like //evil.example would
    // otherwise become a different host. originalUrl always starts with "/".
    res.redirect(301, origin + req.originalUrl);
  };
}

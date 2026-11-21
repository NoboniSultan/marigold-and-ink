import { ForbiddenError } from '../errors/index.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originFromReferer(referer) {
  try {
    return referer ? new URL(referer).origin : undefined;
  } catch {
    return 'invalid';
  }
}

/**
 * CSRF defense, layer two (layer one is the SameSite=Lax session cookie).
 *
 * CSRF = a malicious site making the victim's browser send a state-changing request to
 * our API with the victim's cookie attached. Browsers always label such requests with
 * the page's real Origin (or at least a Referer), which a malicious page cannot forge.
 * So for any state-changing method we reject requests whose Origin isn't on our allow-list.
 *
 * Requests with neither header are allowed: browsers send Origin on every cross-origin
 * POST, so a missing header means a non-browser client (curl, a server, a Stripe webhook),
 * which can't be carrying a victim's cookie in the first place.
 */
export function requireTrustedOrigin({ allowedOrigins }) {
  const allowed = new Set(allowedOrigins);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin') ?? originFromReferer(req.get('referer'));
    if (origin === undefined || allowed.has(origin)) return next();

    next(new ForbiddenError('Cross-site request blocked', { code: 'CSRF_ORIGIN_MISMATCH' }));
  };
}

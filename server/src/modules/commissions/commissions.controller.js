import * as commissionsService from './commissions.service.js';
import { logger } from '../../lib/logger.js';

export async function create(req, res) {
  const commission = await commissionsService.createCommission(req.user, req.validated.body);
  res.status(201).json({ data: commission });
}

export async function list(req, res) {
  const { commissions, meta } = await commissionsService.listCommissions(
    req.user,
    req.validated.query,
  );
  res.json({ data: commissions, meta });
}

export async function getById(req, res) {
  const commission = await commissionsService.getCommissionDetails(
    req.validated.params.id,
    req.user,
  );
  res.json({ data: commission });
}

export async function changeStatus(req, res) {
  const commission = await commissionsService.changeStatus(
    req.validated.params.id,
    req.user,
    req.validated.body,
  );
  // Follow-up work other modules attach in createApp (closing Stripe pages on cancel). The
  // change is already committed, so a failure here is logged, never reported as a failure.
  try {
    await req.app.locals.onCommissionStatusChange?.(commission);
  } catch (err) {
    logger.warn({ err, commissionId: commission.id }, 'after-status-change step failed');
  }
  res.json({ data: commission });
}

export async function listEvents(req, res) {
  const events = await commissionsService.listEvents(req.validated.params.id, req.user);
  res.json({ data: events });
}

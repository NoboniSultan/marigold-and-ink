import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type { GivingTotals } from '@shared/types/giving.ts';
import type { MarkDonationsPaidRequest } from '@shared/types/admin.ts';
import * as givingService from './giving.service.ts';

export async function totals(_req: Request, res: Response) {
  res.json({ data: await givingService.getPublicTotals() } satisfies ApiResponse<GivingTotals>);
}

// --- Admin (mounted on the admin router) ---

/** Donations for the Giving screen, newest first; ?status=owed to list what's owed. */
export async function listDonations(req: Request, res: Response) {
  const { donations, meta } = await givingService.listDonations(
    req.validated.query as Parameters<typeof givingService.listDonations>[0],
  );
  res.json({ data: donations, meta });
}

/** Marks several owed donations paid with one invoice's date and receipt. */
export async function markPaid(req: Request, res: Response) {
  const paid = await givingService.markDonationsPaid(
    req.validated.body as MarkDonationsPaidRequest,
  );
  res.json({ data: paid });
}

import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type { GivingTotals } from '@shared/types/giving.ts';
import * as givingService from './giving.service.ts';

export async function totals(_req: Request, res: Response) {
  res.json({ data: await givingService.getPublicTotals() } satisfies ApiResponse<GivingTotals>);
}

import type { Request, Response } from 'express';
import type { ApiResponse } from '@shared/types/api.ts';
import type { CommissionOptions } from '@shared/types/commission.ts';
import * as pricingService from './pricing.service.js';
import { toCommissionOptions } from './pricing.options.ts';

export async function getOptions(_req: Request, res: Response) {
  const options = toCommissionOptions(await pricingService.getActiveRules());
  res.json({ data: options } satisfies ApiResponse<CommissionOptions>);
}

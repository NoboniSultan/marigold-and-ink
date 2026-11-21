import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { STATUSES } from './commissions.stateMachine.js';

export const commissionIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

// Only these fields are read. Anything else, including price fields like "totalCents"
// or "depositCents", is stripped by zod and never reaches the service.
export const createCommissionBody = z.object({
  size: z.string().trim().min(1).max(50),
  medium: z.string().trim().min(1).max(50),
  subjectCount: z.coerce.number().int().min(1).max(100),
  fulfillmentType: z.enum(['digital', 'physical', 'mixed_media']),
  isRush: z.boolean().default(false),
  notes: z.string().trim().max(5000).optional(),
});

export const listCommissionsQuery = paginationQuery.extend({
  status: z.enum(STATUSES).optional(),
});

export const changeStatusBody = z.object({
  toStatus: z.enum(STATUSES),
  reason: z.string().trim().min(1).max(500).optional(),
});

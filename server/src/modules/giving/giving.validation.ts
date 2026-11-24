import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';

export const donationsQuery = paginationQuery.extend({
  status: z.enum(['pending', 'owed', 'paid', 'reversed']).optional(),
});

/** One invoice from the planting partner usually covers several commissions' trees. */
export const markDonationsPaidBody = z.object({
  donationIds: z.array(z.number().int().positive()).min(1).max(200),
  payoutDate: z.iso.date('must be a date (YYYY-MM-DD)'),
  receiptReference: z.string().trim().min(1, 'is required').max(200),
});

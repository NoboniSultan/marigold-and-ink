import { z } from 'zod';

/** ?year=2026; the current year (New York time) when left out. */
export const monthlyReportQuery = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
});

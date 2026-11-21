import { z } from 'zod';

export const quoteParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const adjustQuoteBody = z.object({
  // Integer cents only: 12500 means $125.00. Capped to keep typos (an extra zero or two)
  // from producing an absurd quote.
  adjustedAmountCents: z.number().int().min(0).max(10_000_000),
  adjustmentNote: z.string().trim().min(1, 'is required when adjusting a price').max(500),
});

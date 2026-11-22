import { z } from 'zod';

export const commissionParams = z.object({
  id: z.coerce.number().int().positive(),
});

/** No amounts here on purpose: what to charge always comes from the stored quote. */
export const checkoutParams = commissionParams.extend({
  type: z.enum(['deposit', 'final']),
});

export const refundBody = z.object({
  /** The deposit or final payment to refund. */
  paymentId: z.number().int().positive(),
  /** Leave out to refund everything not yet refunded; integer cents otherwise. */
  amountCents: z.number().int().positive().optional(),
  /** Kept with the refund for the record (not shown to the client). */
  reason: z.string().trim().min(1, 'is required').max(500),
});

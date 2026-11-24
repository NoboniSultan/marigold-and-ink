import { z } from 'zod';

export const commissionParams = z.object({ id: z.coerce.number().int().positive() });

export const fileParams = commissionParams.extend({
  fileId: z.coerce.number().int().positive(),
});

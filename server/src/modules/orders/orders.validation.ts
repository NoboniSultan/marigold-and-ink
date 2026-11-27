import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { MAX_LINES, MAX_QUANTITY } from './orders.rules.ts';
import { ORDER_STATUSES } from './orders.stateMachine.ts';

const id = z.coerce.number().int().positive();

/** A cart: only what was chosen. Prices and stock come from the shop, never the request. */
export const cartBody = z
  .object({
    items: z
      .array(
        z
          .object({
            variantId: z.number().int().positive(),
            quantity: z.number().int().min(1).max(MAX_QUANTITY),
          })
          .strict(),
      )
      .min(1, 'The cart is empty')
      .max(MAX_LINES),
  })
  .strict();

export const orderParams = z.object({ id });

export const myOrdersQuery = paginationQuery;

export const adminOrdersQuery = paginationQuery.extend({
  status: z.enum(ORDER_STATUSES).optional(),
});

export const refundBody = z
  .object({
    reason: z.string().trim().min(1).max(500),
    restock: z.boolean(),
  })
  .strict();

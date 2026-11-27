import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { MAX_LINES, MAX_QUANTITY } from './orders.rules.ts';
import { ORDER_STATUSES } from './orders.stateMachine.ts';
import { addressBody } from '../shipping/shipping.validation.ts';

const id = z.coerce.number().int().positive();

const cartItems = z
  .array(
    z
      .object({
        variantId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
      })
      .strict(),
  )
  .min(1, 'The cart is empty')
  .max(MAX_LINES);

/** A cart: only what was chosen. Prices and stock come from the shop, never the request. */
export const cartBody = z.object({ items: cartItems }).strict();

/** A cart and where it's going, for live shipping options (milestone 12c). */
export const shippingOptionsBody = z.object({ items: cartItems, address: addressBody }).strict();

/**
 * Checkout: the cart and, for a shipped order, the address, the service chosen, and the price
 * the customer saw (only to notice a change: the price is always taken again).
 */
export const checkoutBody = z
  .object({
    items: cartItems,
    shipping: z
      .object({
        address: addressBody,
        serviceToken: z.string().trim().min(1).max(60),
        expectedCents: z.number().int().min(0).max(10_000_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const markBody = z.object({ toStatus: z.enum(['shipped', 'delivered']) }).strict();

export const labelBody = z.object({ rateId: z.string().trim().min(1).max(100) }).strict();

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

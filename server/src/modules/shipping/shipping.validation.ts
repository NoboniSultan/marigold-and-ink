import { z } from 'zod';
import { MAX_SIDE_IN, MAX_WEIGHT_OZ, US_STATES } from './shipping.rules.ts';

export const commissionParams = z.object({ id: z.coerce.number().int().positive() });

const text = (max: number) => z.string().trim().min(1).max(max);

export const addressBody = z.object({
  name: text(100),
  line1: text(100),
  // An empty second line means there isn't one.
  line2: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((value) => value || null),
  city: text(60),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(US_STATES, { message: 'Choose a US state' })),
  postalCode: z
    .string()
    .trim()
    .regex(/^[0-9]{5}(-[0-9]{4})?$/, 'Enter a 5-digit ZIP code'),
});

/** Up to two decimals, above zero, at most `max`. */
const measure = (max: number) =>
  z
    .number()
    .positive()
    .max(max)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: 'may have at most two decimal places',
    });

export const packageBody = z.object({
  weightOz: measure(MAX_WEIGHT_OZ),
  lengthIn: measure(MAX_SIDE_IN),
  widthIn: measure(MAX_SIDE_IN),
  heightIn: measure(MAX_SIDE_IN),
});

export const chooseBody = z.object({ rateId: z.string().trim().min(1).max(100) });

export const labelBody = z.object({ rateId: z.string().trim().min(1).max(100) });

export const webhookQuery = z.object({ token: z.string().max(200).optional() });

/**
 * A Shippo webhook. Only the event name and tracking number are used (to find the label);
 * the rest is read from Shippo itself, so nothing else in the body is trusted or needed.
 */
export const webhookBody = z.object({
  event: z.string().max(100),
  data: z
    .object({ tracking_number: z.string().max(100).optional() })
    .loose()
    .nullish()
    .catch(null),
});

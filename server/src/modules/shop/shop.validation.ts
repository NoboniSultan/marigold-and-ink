import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';
import { SLUG_PATTERN } from '../../lib/slug.ts';
import { PRODUCT_CATEGORIES } from './shop.rules.ts';

const slug = z
  .string()
  .trim()
  .max(120)
  .regex(SLUG_PATTERN, 'must be lowercase words joined by hyphens');
const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional text: empty or null clears it. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);
const id = z.coerce.number().int().positive();
const category = z.enum(PRODUCT_CATEGORIES);
/** Up to $100,000, in cents. */
const priceCents = z.number().int().min(1).max(10_000_000);
const stock = z.number().int().min(0).max(100_000);
/** Up to two decimals, above zero, at most `max` (ounces or inches). */
const measure = (max: number) =>
  z
    .number()
    .positive()
    .max(max)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
      message: 'may have at most two decimal places',
    });
const weightOz = measure(1120).nullable();

export const productSlugParams = z.object({ slug });
export const productIdParams = z.object({ id });
export const variantParams = z.object({ variantId: id });
export const photoParams = z.object({ photoId: id });

export const shopListQuery = paginationQuery.extend({ category: category.optional() });

const productFields = {
  name: text(120),
  slug,
  category,
  description: z.string().trim().max(5000),
  materials: optionalText(500),
  dimensions: optionalText(200),
  oneOfAKind: z.boolean(),
  packingTypeId: id.nullable(),
  pickupOnly: z.boolean(),
};

export const createProductBody = z
  .object({
    ...productFields,
    slug: slug.optional(),
    description: productFields.description.default(''),
    materials: productFields.materials.default(null),
    dimensions: productFields.dimensions.default(null),
    oneOfAKind: z.boolean().default(false),
    packingTypeId: id.nullable().optional(),
    pickupOnly: z.boolean().optional(),
  })
  .strict();

export const updateProductBody = z
  .object({ ...productFields, published: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');

export const variantBody = z
  .object({ name: text(80), priceCents, stock, weightOz: weightOz.optional() })
  .strict();

export const updateVariantBody = z
  .object({ name: text(80), priceCents, weightOz })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');

export const stockBody = z
  .object({
    stock,
    reason: z.enum(['restock', 'adjustment']),
    note: optionalText(300).optional(),
  })
  .strict();

export const photoBody = z.object({ altText: optionalText(300) }).strict();

export const photoOrderBody = z.object({ photoIds: z.array(id).min(1).max(50) }).strict();

/**
 * A product photo's address: /media/shop/products/<product>/<hash>-<size>.webp. Loose on
 * purpose: the service only serves keys of the exact shape, and answers 404 for the rest,
 * as a missing image should.
 */
export const photoFileParams = z.object({
  productId: z.string().max(20),
  file: z.string().max(100),
});

export const packingTypeParams = z.object({ packingTypeId: id });

export const packingTypeBody = z
  .object({
    name: text(60),
    lengthIn: measure(108),
    widthIn: measure(108),
    heightIn: measure(108),
    // An empty mailer can weigh next to nothing; zero is allowed.
    weightOz: z
      .number()
      .min(0)
      .max(1120)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
        message: 'may have at most two decimal places',
      }),
  })
  .strict();

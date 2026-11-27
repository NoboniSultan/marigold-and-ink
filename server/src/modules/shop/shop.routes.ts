import express, { Router } from 'express';
import { optionalAuth } from '../../middleware/auth.js';
import { uploadRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import * as shopController from './shop.controller.ts';
import {
  createProductBody,
  photoBody,
  photoFileParams,
  photoOrderBody,
  packingTypeBody,
  packingTypeParams,
  photoParams,
  productIdParams,
  productSlugParams,
  shopListQuery,
  stockBody,
  updateProductBody,
  updateVariantBody,
  variantBody,
  variantParams,
} from './shop.validation.ts';

/**
 * Mounted at /shop. Public once the shop is open; until then it answers the admin only
 * (optionalAuth lets the service tell who's asking).
 */
export const shopRouter = Router();
shopRouter.get('/', shopController.status);
shopRouter.get('/products', optionalAuth, validate({ query: shopListQuery }), shopController.list);
shopRouter.get(
  '/products/:slug',
  optionalAuth,
  validate({ params: productSlugParams }),
  shopController.getBySlug,
);

/**
 * Product photos, mounted by app.js at /media/shop/products (before sessions, like the
 * gallery's images): /media/shop/products/<product>/<hash>-<size>.webp.
 */
export const shopPhotosRouter = Router();
shopPhotosRouter.get(
  '/:productId/:file',
  validate({ params: photoFileParams }),
  shopController.photo,
);

/** Mounted on the admin router (admin only) at /admin/shop. */
export const adminShopRouter = Router();

adminShopRouter.get('/products', validate({ query: shopListQuery }), shopController.adminList);
adminShopRouter.post('/products', validate({ body: createProductBody }), shopController.create);
adminShopRouter.get(
  '/products/:id',
  validate({ params: productIdParams }),
  shopController.adminGet,
);
adminShopRouter.patch(
  '/products/:id',
  validate({ params: productIdParams, body: updateProductBody }),
  shopController.update,
);
adminShopRouter.delete(
  '/products/:id',
  validate({ params: productIdParams }),
  shopController.remove,
);

adminShopRouter.post(
  '/products/:id/variants',
  validate({ params: productIdParams, body: variantBody }),
  shopController.addVariant,
);
adminShopRouter.patch(
  '/variants/:variantId',
  validate({ params: variantParams, body: updateVariantBody }),
  shopController.updateVariant,
);
adminShopRouter.put(
  '/variants/:variantId/stock',
  validate({ params: variantParams, body: stockBody }),
  shopController.setStock,
);
adminShopRouter.get(
  '/variants/:variantId/movements',
  validate({ params: variantParams }),
  shopController.movements,
);
adminShopRouter.delete(
  '/variants/:variantId',
  validate({ params: variantParams }),
  shopController.removeVariant,
);

// The photo is the request body; capped a little above the 20 MB limit so the service can
// answer with a clear message.
adminShopRouter.post(
  '/products/:id/photos',
  uploadRateLimiter,
  express.raw({ type: () => true, limit: '21mb' }),
  validate({ params: productIdParams }),
  shopController.uploadPhoto,
);
adminShopRouter.patch(
  '/photos/:photoId',
  validate({ params: photoParams, body: photoBody }),
  shopController.updatePhoto,
);
adminShopRouter.put(
  '/products/:id/photo-order',
  validate({ params: productIdParams, body: photoOrderBody }),
  shopController.reorderPhotos,
);
adminShopRouter.delete(
  '/photos/:photoId',
  validate({ params: photoParams }),
  shopController.removePhoto,
);

// The owner's mailers and boxes (milestone 12c).
adminShopRouter.get('/packing-types', shopController.listPackingTypes);
adminShopRouter.post(
  '/packing-types',
  validate({ body: packingTypeBody }),
  shopController.createPackingType,
);
adminShopRouter.put(
  '/packing-types/:packingTypeId',
  validate({ params: packingTypeParams, body: packingTypeBody }),
  shopController.updatePackingType,
);
adminShopRouter.delete(
  '/packing-types/:packingTypeId',
  validate({ params: packingTypeParams }),
  shopController.deletePackingType,
);

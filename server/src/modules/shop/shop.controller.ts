import type { Request, Response } from 'express';
import type { ApiResponse, PaginatedResponse } from '@shared/types/api.ts';
import type {
  AdminProduct,
  InventoryMovement,
  Product,
  ProductCategory,
  ProductInput,
  ProductSummary,
  ProductUpdate,
  ShopStatus,
  StockChange,
  VariantInput,
} from '@shared/types/shop.ts';
import type { AppAdapters } from '../../adapters/index.ts';
import * as shopService from './shop.service.ts';

type User = { id: number; role: 'client' | 'admin' };
type ListQuery = { category?: ProductCategory; page: number; pageSize: number };

const storage = (req: Request) => ({
  storage: (req.app.locals.adapters as AppAdapters).storage,
});
const shopOpen = (req: Request) => ({ shopOpen: Boolean(req.app.locals.shopOpen) });
const params = <T>(req: Request) => req.validated.params as T;
const productId = (req: Request) => params<{ id: number }>(req).id;
const variantId = (req: Request) => params<{ variantId: number }>(req).variantId;
const photoId = (req: Request) => params<{ photoId: number }>(req).photoId;

const sendProduct = (res: Response, product: AdminProduct, status = 200) =>
  res.status(status).json({ data: product } satisfies ApiResponse<AdminProduct>);

// --- Public ---

export function status(req: Request, res: Response) {
  res.json({ data: { open: shopOpen(req).shopOpen } } satisfies ApiResponse<ShopStatus>);
}

export async function list(req: Request, res: Response) {
  const result = await shopService.listShopProducts(
    req.user as User | undefined,
    req.validated.query as ListQuery,
    shopOpen(req),
  );
  res.json(result satisfies PaginatedResponse<ProductSummary>);
}

export async function getBySlug(req: Request, res: Response) {
  const product = await shopService.getShopProduct(
    req.user as User | undefined,
    params<{ slug: string }>(req).slug,
    shopOpen(req),
  );
  res.json({ data: product } satisfies ApiResponse<Product>);
}

/** A product photo, served by the site. Names contain a content hash: cache forever. */
export async function photo(req: Request, res: Response) {
  const { productId: id, file } = params<{ productId: string; file: string }>(req);
  const object = await shopService.servePhoto(`shop/products/${id}/${file}`, storage(req));
  res.set({
    'Content-Type': object.contentType,
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  res.send(object.body);
}

// --- Admin ---

export async function adminList(req: Request, res: Response) {
  const result = await shopService.listAdminProducts(req.validated.query as ListQuery);
  res.json(result satisfies PaginatedResponse<AdminProduct>);
}

export async function adminGet(req: Request, res: Response) {
  sendProduct(res, await shopService.getAdminProduct(productId(req)));
}

export async function create(req: Request, res: Response) {
  sendProduct(res, await shopService.createProduct(req.validated.body as ProductInput), 201);
}

export async function update(req: Request, res: Response) {
  sendProduct(
    res,
    await shopService.updateProduct(productId(req), req.validated.body as ProductUpdate),
  );
}

export async function remove(req: Request, res: Response) {
  await shopService.deleteProduct(productId(req), storage(req));
  res.status(204).end();
}

export async function addVariant(req: Request, res: Response) {
  sendProduct(
    res,
    await shopService.addVariant(
      req.user as User,
      productId(req),
      req.validated.body as VariantInput,
    ),
    201,
  );
}

export async function updateVariant(req: Request, res: Response) {
  sendProduct(
    res,
    await shopService.updateVariant(
      variantId(req),
      req.validated.body as { name?: string; priceCents?: number },
    ),
  );
}

export async function setStock(req: Request, res: Response) {
  sendProduct(
    res,
    await shopService.setVariantStock(
      req.user as User,
      variantId(req),
      req.validated.body as StockChange,
    ),
  );
}

export async function movements(req: Request, res: Response) {
  const list = await shopService.listMovements(variantId(req));
  res.json({ data: list } satisfies ApiResponse<InventoryMovement[]>);
}

export async function removeVariant(req: Request, res: Response) {
  sendProduct(res, await shopService.deleteVariant(variantId(req)));
}

/** The photo is the raw request body (express.raw). */
export async function uploadPhoto(req: Request, res: Response) {
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  sendProduct(res, await shopService.uploadPhoto(productId(req), data, storage(req)), 201);
}

export async function updatePhoto(req: Request, res: Response) {
  const { altText } = req.validated.body as { altText: string | null };
  sendProduct(res, await shopService.setPhotoAltText(photoId(req), altText));
}

export async function reorderPhotos(req: Request, res: Response) {
  const { photoIds } = req.validated.body as { photoIds: number[] };
  sendProduct(res, await shopService.reorderPhotos(productId(req), photoIds));
}

export async function removePhoto(req: Request, res: Response) {
  sendProduct(res, await shopService.deletePhoto(photoId(req), storage(req)));
}

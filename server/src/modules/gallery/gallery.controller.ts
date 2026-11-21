/**
 * HTTP in and out for the gallery. Inputs come only from `req.validated` (set by the
 * validate middleware), so the casts below are safe. `satisfies` checks each response
 * against the shared API types at compile time.
 */
import type { Request, Response } from 'express';
import type { AdminArtwork, Artwork, CategoryCount, Tag } from '@shared/types/artwork.ts';
import type { ApiResponse, PaginatedResponse } from '@shared/types/api.ts';
import * as galleryService from './gallery.service.ts';
import type {
  AdminListArtworksQuery,
  CreateArtworkInput,
  CreateTagInput,
  ListArtworksQuery,
  UpdateArtworkInput,
  UpdateTagInput,
} from './gallery.validation.ts';

const params = <T>(req: Request) => req.validated.params as T;
type IdParams = { id: number };

// --- Public ---

export async function list(req: Request, res: Response) {
  const { artworks, meta } = await galleryService.listPublicArtworks(
    req.validated.query as ListArtworksQuery,
  );
  res.json({ data: artworks, meta } satisfies PaginatedResponse<Artwork>);
}

export async function getBySlug(req: Request, res: Response) {
  const artwork = await galleryService.getPublicArtwork(params<{ slug: string }>(req).slug);
  res.json({ data: artwork } satisfies ApiResponse<Artwork>);
}

export async function listCategories(_req: Request, res: Response) {
  res.json({ data: await galleryService.listCategories() } satisfies ApiResponse<CategoryCount[]>);
}

export async function listTags(_req: Request, res: Response) {
  res.json({ data: await galleryService.listPublicTags() } satisfies ApiResponse<Tag[]>);
}

// --- Admin ---

export async function adminList(req: Request, res: Response) {
  const { artworks, meta } = await galleryService.listAdminArtworks(
    req.validated.query as AdminListArtworksQuery,
  );
  res.json({ data: artworks, meta } satisfies PaginatedResponse<AdminArtwork>);
}

export async function adminGet(req: Request, res: Response) {
  const artwork = await galleryService.getAdminArtwork(params<IdParams>(req).id);
  res.json({ data: artwork } satisfies ApiResponse<AdminArtwork>);
}

export async function create(req: Request, res: Response) {
  const artwork = await galleryService.createArtwork(req.validated.body as CreateArtworkInput);
  res.status(201).json({ data: artwork } satisfies ApiResponse<AdminArtwork>);
}

export async function update(req: Request, res: Response) {
  const artwork = await galleryService.updateArtwork(
    params<IdParams>(req).id,
    req.validated.body as UpdateArtworkInput,
  );
  res.json({ data: artwork } satisfies ApiResponse<AdminArtwork>);
}

export async function remove(req: Request, res: Response) {
  await galleryService.deleteArtwork(params<IdParams>(req).id);
  res.status(204).end();
}

export async function adminListTags(_req: Request, res: Response) {
  res.json({ data: await galleryService.listAllTags() } satisfies ApiResponse<Tag[]>);
}

export async function createTag(req: Request, res: Response) {
  const tag = await galleryService.createTag(req.validated.body as CreateTagInput);
  res.status(201).json({ data: tag } satisfies ApiResponse<Tag>);
}

export async function updateTag(req: Request, res: Response) {
  const tag = await galleryService.updateTag(
    params<IdParams>(req).id,
    req.validated.body as UpdateTagInput,
  );
  res.json({ data: tag } satisfies ApiResponse<Tag>);
}

export async function removeTag(req: Request, res: Response) {
  await galleryService.deleteTag(params<IdParams>(req).id);
  res.status(204).end();
}

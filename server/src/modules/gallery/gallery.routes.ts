import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as galleryController from './gallery.controller.ts';
import {
  adminListArtworksQuery,
  artworkSlugParams,
  createArtworkBody,
  createTagBody,
  idParams,
  listArtworksQuery,
  updateArtworkBody,
  updateTagBody,
} from './gallery.validation.ts';

// Public: published artworks only.
export const artworksRouter = Router();

artworksRouter.get('/', validate({ query: listArtworksQuery }), galleryController.list);
// Registered before '/:slug' so "categories" isn't read as an artwork slug.
artworksRouter.get('/categories', galleryController.listCategories);
artworksRouter.get('/:slug', validate({ params: artworkSlugParams }), galleryController.getBySlug);

export const tagsRouter = Router();

tagsRouter.get('/', galleryController.listTags);

// Admin: mounted under /admin, whose router requires an admin for every route (routes.js).
export const adminArtworksRouter = Router();

adminArtworksRouter.get(
  '/',
  validate({ query: adminListArtworksQuery }),
  galleryController.adminList,
);
adminArtworksRouter.post('/', validate({ body: createArtworkBody }), galleryController.create);
adminArtworksRouter.get('/:id', validate({ params: idParams }), galleryController.adminGet);
adminArtworksRouter.patch(
  '/:id',
  validate({ params: idParams, body: updateArtworkBody }),
  galleryController.update,
);
adminArtworksRouter.delete('/:id', validate({ params: idParams }), galleryController.remove);

export const adminTagsRouter = Router();

adminTagsRouter.get('/', galleryController.adminListTags);
adminTagsRouter.post('/', validate({ body: createTagBody }), galleryController.createTag);
adminTagsRouter.patch(
  '/:id',
  validate({ params: idParams, body: updateTagBody }),
  galleryController.updateTag,
);
adminTagsRouter.delete('/:id', validate({ params: idParams }), galleryController.removeTag);

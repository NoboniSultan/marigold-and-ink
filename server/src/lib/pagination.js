import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/** Query-string schema shared by every list endpoint: ?page=2&pageSize=20 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

/** Converts page/pageSize into SQL LIMIT/OFFSET values. */
export function toLimitOffset({ page, pageSize }) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

/** The `meta` block for list responses: { data: [...], meta: { page, pageSize, total } }. */
export function toPageMeta({ page, pageSize }, total) {
  return { page, pageSize, total };
}

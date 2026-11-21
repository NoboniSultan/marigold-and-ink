import { z } from 'zod';
import { paginationQuery } from '../../lib/pagination.js';

export const userIdParams = z.object({
  id: z.coerce.number().int().positive(),
});

export const listUsersQuery = paginationQuery;

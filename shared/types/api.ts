/**
 * Response envelopes shared by the API and the React client. Type-only: this folder has no
 * runtime code, so both sides import it with `import type` and nothing is bundled or run.
 */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** `{ data }` for a single resource. */
export interface ApiResponse<T> {
  data: T;
}

/** `{ data: [...], meta }` for a paginated list. */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PageMeta;
}

/** Every error response. `code` is stable and safe to branch on; `message` is for people. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

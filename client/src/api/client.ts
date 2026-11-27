/**
 * The only place in the client that calls fetch(). Every request goes through `request`,
 * so cookies, JSON, and error handling work the same everywhere.
 */
import type { ApiErrorBody } from '@shared/types/api.ts';

/** Same origin in development (Vite proxy) and production (Express serves the site). */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

/** A failed API call, carrying the server's stable error code (e.g. 'EMAIL_TAKEN'). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** One field problem from a 400 VALIDATION_ERROR response. */
export interface FieldIssue {
  location: string;
  path: string;
  message: string;
}

/** Field errors from a validation failure, keyed by field name, for showing under inputs. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const result: Record<string, string> = {};
  for (const issue of error.details as FieldIssue[]) {
    if (issue.path && !result[issue.path]) result[issue.path] = issue.message;
  }
  return result;
}

/** A sentence for the top of a form when a request fails. */
export function formMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (error.code === 'VALIDATION_ERROR') return 'Please check the highlighted fields.';
  return error.message;
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

function toQueryString(query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Resolves to the response's `data` field (or undefined for 204), or throws ApiError. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal } = options;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${toQueryString(query)}`, {
      method,
      signal,
      // The session cookie is httpOnly: JavaScript never sees it; the browser sends it.
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (json as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'Something went wrong. Please try again.',
      error?.details,
    );
  }
  return json as T;
}

/**
 * Uploads one file as the request body (the server checks its real type), with its name in
 * X-Filename. Resolves to the response's JSON, or throws ApiError like `request`.
 */
export async function upload<T>(path: string, file: Blob, filename: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(filename),
      },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection.");
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (json as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? (response.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UNKNOWN_ERROR'),
      error?.message ??
        (response.status === 413
          ? 'That file is too large.'
          : 'Something went wrong. Please try again.'),
      error?.details,
    );
  }
  return json as T;
}

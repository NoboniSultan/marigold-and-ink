/** Typed functions for each API endpoint the site uses. Types come from shared/types. */
import type { AboutContent } from '@shared/types/about.ts';
import type { ApiResponse, PaginatedResponse } from '@shared/types/api.ts';
import type { Artwork, CategoryCount, Tag } from '@shared/types/artwork.ts';
import type {
  Commission,
  CommissionDetails,
  CommissionOptions,
  CommissionRequest,
} from '@shared/types/commission.ts';
import type { CheckoutStart, PaymentsResponse } from '@shared/types/payment.ts';
import type {
  Account,
  AuthProviders,
  ChangePasswordRequest,
  DeleteAccountRequest,
  LoginRequest,
  SignupCompleteRequest,
  SignupStartRequest,
  SignupStartResponse,
  UpdateProfileRequest,
  User,
} from '@shared/types/user.ts';
import { request } from './client.ts';

export interface ArtworkFilters {
  page?: number;
  pageSize?: number;
  category?: string;
  tag?: string;
  q?: string;
}

const data = async <T>(promise: Promise<ApiResponse<T>>): Promise<T> => (await promise).data;

export const artworksApi = {
  list: (filters: ArtworkFilters = {}, signal?: AbortSignal) =>
    request<PaginatedResponse<Artwork>>('/artworks', { query: { ...filters }, signal }),
  get: (slug: string, signal?: AbortSignal) =>
    data(request<ApiResponse<Artwork>>(`/artworks/${encodeURIComponent(slug)}`, { signal })),
  categories: (signal?: AbortSignal) =>
    data(request<ApiResponse<CategoryCount[]>>('/artworks/categories', { signal })),
  tags: (signal?: AbortSignal) =>
    data(request<ApiResponse<(Tag & { count: number })[]>>('/tags', { signal })),
};

export const aboutApi = {
  get: (signal?: AbortSignal) => data(request<ApiResponse<AboutContent>>('/about', { signal })),
};

export const authApi = {
  /**
   * The logged-in user, or null. GET /auth/session answers 200 either way, so a visitor who
   * isn't logged in doesn't produce an error (and a console warning) on every page load.
   */
  me: (signal?: AbortSignal) =>
    data(request<ApiResponse<User | null>>('/auth/session', { signal })),
  login: (body: LoginRequest) =>
    data(request<ApiResponse<User>>('/auth/login', { method: 'POST', body })),
  /** Sign-up step 1: emails a 6-digit code. */
  signupStart: (body: SignupStartRequest) =>
    data(request<ApiResponse<SignupStartResponse>>('/auth/signup/start', { method: 'POST', body })),
  /** Sign-up step 2: the code plus name and password; creates the account and logs in. */
  signupComplete: (body: SignupCompleteRequest) =>
    data(request<ApiResponse<User>>('/auth/signup/complete', { method: 'POST', body })),
  providers: (signal?: AbortSignal) =>
    data(request<ApiResponse<AuthProviders>>('/auth/providers', { signal })),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};

/** The signed-in user's own account (the account page). */
export const accountApi = {
  get: (signal?: AbortSignal) => data(request<ApiResponse<Account>>('/users/me', { signal })),
  update: (body: UpdateProfileRequest) =>
    data(request<ApiResponse<Account>>('/users/me', { method: 'PATCH', body })),
  changePassword: (body: ChangePasswordRequest) =>
    request<void>('/users/me/password', { method: 'POST', body }),
  delete: (body: DeleteAccountRequest) => request<void>('/users/me', { method: 'DELETE', body }),
};

export const commissionsApi = {
  /** The signed-in client's own commissions, newest first. */
  mine: (signal?: AbortSignal) =>
    request<PaginatedResponse<Commission>>('/commissions', { query: { pageSize: 50 }, signal }),
  options: (signal?: AbortSignal) =>
    data(request<ApiResponse<CommissionOptions>>('/pricing/options', { signal })),
  create: (body: CommissionRequest) =>
    data(request<ApiResponse<Commission>>('/commissions', { method: 'POST', body })),
  get: (id: number, signal?: AbortSignal) =>
    data(request<ApiResponse<CommissionDetails>>(`/commissions/${id}`, { signal })),
};

export const paymentsApi = {
  list: (commissionId: number, signal?: AbortSignal) =>
    request<PaymentsResponse>(`/commissions/${commissionId}/payments`, { signal }),
  /** Returns Stripe's Checkout URL; the browser then goes there to pay. */
  start: (commissionId: number, type: 'deposit' | 'final') =>
    data(
      request<ApiResponse<CheckoutStart>>(`/commissions/${commissionId}/payments/${type}`, {
        method: 'POST',
      }),
    ),
};

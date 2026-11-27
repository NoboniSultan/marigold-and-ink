/** Typed functions for each API endpoint the site uses. Types come from shared/types. */
import type { AboutContent } from '@shared/types/about.ts';
import type {
  LabelOption,
  Shipment,
  ShippingAddressInput,
  ShippingOption,
  ShippingPackage,
  ShippingResponse,
} from '@shared/types/shipping.ts';
import type {
  AdjustQuoteRequest,
  AdminCommissionDetails,
  AdminCommissionRow,
  AdminDonation,
  DonationStatus,
  MarkDonationsPaidRequest,
  MonthlyReportRow,
  Quote,
  TransitionRequest,
} from '@shared/types/admin.ts';
import type { ApiResponse, PaginatedResponse } from '@shared/types/api.ts';
import type { Artwork, CategoryCount, Tag } from '@shared/types/artwork.ts';
import type {
  Commission,
  CommissionDetails,
  CommissionOptions,
  CommissionRequest,
} from '@shared/types/commission.ts';
import type { GivingTotals } from '@shared/types/giving.ts';
import type {
  CheckoutStart,
  Payment,
  PaymentsResponse,
  RefundRequest,
} from '@shared/types/payment.ts';
import type {
  Account,
  AuthProviders,
  ChangeEmailConfirmRequest,
  ChangeEmailStartRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  LoginRequest,
  PasswordResetCompleteRequest,
  PasswordResetStartRequest,
  SignupCompleteRequest,
  SignupStartRequest,
  SignupStartResponse,
  UpdateProfileRequest,
  User,
} from '@shared/types/user.ts';
import { API_BASE, request, upload } from './client.ts';
import type { CommissionFile, FilesResponse } from '@shared/types/files.ts';

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
  /** Forgot password, step 1: emails a code if the address has an account. */
  passwordResetStart: (body: PasswordResetStartRequest) =>
    data(
      request<ApiResponse<SignupStartResponse>>('/auth/password-reset/start', {
        method: 'POST',
        body,
      }),
    ),
  /** Step 2: the code and the new password; signs this browser in. */
  passwordResetComplete: (body: PasswordResetCompleteRequest) =>
    data(request<ApiResponse<User>>('/auth/password-reset/complete', { method: 'POST', body })),
  providers: (signal?: AbortSignal) =>
    data(request<ApiResponse<AuthProviders>>('/auth/providers', { signal })),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};

export const givingApi = {
  totals: (signal?: AbortSignal) => data(request<ApiResponse<GivingTotals>>('/giving', { signal })),
};

/** The signed-in user's own account (the account page). */
export const accountApi = {
  get: (signal?: AbortSignal) => data(request<ApiResponse<Account>>('/users/me', { signal })),
  update: (body: UpdateProfileRequest) =>
    data(request<ApiResponse<Account>>('/users/me', { method: 'PATCH', body })),
  changePassword: (body: ChangePasswordRequest) =>
    request<void>('/users/me/password', { method: 'POST', body }),
  delete: (body: DeleteAccountRequest) => request<void>('/users/me', { method: 'DELETE', body }),
  /** Email change, step 1: a code goes to the new address. */
  startEmailChange: (body: ChangeEmailStartRequest) =>
    data(request<ApiResponse<SignupStartResponse>>('/users/me/email', { method: 'POST', body })),
  /** Step 2: the code moves the account; other devices are signed out. */
  confirmEmailChange: (body: ChangeEmailConfirmRequest) =>
    data(request<ApiResponse<Account>>('/users/me/email/confirm', { method: 'POST', body })),
};

/**
 * "Download my data": a plain link (the browser downloads the JSON file with the session
 * cookie), so it isn't a fetch call.
 */
export const ACCOUNT_EXPORT_URL = `${API_BASE}/users/me/export`;

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

/** Shipping a physical commission (milestone 11). Prices come from the server, never the page. */
export const shippingApi = {
  get: (commissionId: number, signal?: AbortSignal) =>
    request<ShippingResponse>(`/commissions/${commissionId}/shipping`, { signal }),
  setAddress: (commissionId: number, address: ShippingAddressInput) =>
    data(
      request<ApiResponse<Shipment>>(`/commissions/${commissionId}/shipping/address`, {
        method: 'PUT',
        body: address,
      }),
    ),
  /** Live prices for the address and package, cheapest first. */
  options: (commissionId: number) =>
    data(
      request<ApiResponse<ShippingOption[]>>(`/commissions/${commissionId}/shipping/options`, {
        method: 'POST',
      }),
    ),
  choose: (commissionId: number, rateId: string) =>
    data(
      request<ApiResponse<Shipment>>(`/commissions/${commissionId}/shipping/choice`, {
        method: 'PUT',
        body: { rateId },
      }),
    ),
  /** Admin: the package's weight (ounces) and size (inches). */
  setPackage: (commissionId: number, parcel: ShippingPackage) =>
    data(
      request<ApiResponse<Shipment>>(`/admin/commissions/${commissionId}/shipping/package`, {
        method: 'PUT',
        body: parcel,
      }),
    ),
  /** Admin: today's label prices (the client's service marked), cheapest first. */
  labelOptions: (commissionId: number) =>
    data(
      request<ApiResponse<LabelOption[]>>(
        `/admin/commissions/${commissionId}/shipping/label-options`,
        { method: 'POST' },
      ),
    ),
  /** Admin: buys the label for one of those prices; answers with the whole shipment. */
  buyLabel: (commissionId: number, rateId: string) =>
    request<ShippingResponse>(`/admin/commissions/${commissionId}/shipping/label`, {
      method: 'POST',
      body: { rateId },
    }),
  /** Admin: voids the label in use (its postage is refunded). */
  voidLabel: (commissionId: number) =>
    request<ShippingResponse>(`/admin/commissions/${commissionId}/shipping/label/void`, {
      method: 'POST',
    }),
  /** Admin: checks the package's tracking now. */
  refreshTracking: (commissionId: number) =>
    request<ShippingResponse>(`/admin/commissions/${commissionId}/shipping/tracking/refresh`, {
      method: 'POST',
    }),
};

/** Admin: opens the label PDF (the server redirects to a fresh, expiring link). */
export const labelFileUrl = (commissionId: number) =>
  `${API_BASE}/admin/commissions/${commissionId}/shipping/label/file`;

/** The admin screens (milestone 9). The server refuses all of these to anyone but the admin. */
export const adminApi = {
  commissions: (query: { page?: number; status?: string }, signal?: AbortSignal) =>
    request<PaginatedResponse<AdminCommissionRow>>('/admin/commissions', { query, signal }),
  commission: (id: number, signal?: AbortSignal) =>
    data(request<ApiResponse<AdminCommissionDetails>>(`/admin/commissions/${id}`, { signal })),
  /** The current quote, drafts included (the admin sees them), or 404 if there's none. */
  quote: (id: number, signal?: AbortSignal) =>
    data(request<ApiResponse<Quote>>(`/commissions/${id}/quote`, { signal })),
  generateQuote: (id: number) =>
    data(request<ApiResponse<Quote>>(`/commissions/${id}/quote`, { method: 'POST' })),
  adjustQuote: (id: number, body: AdjustQuoteRequest) =>
    data(request<ApiResponse<Quote>>(`/commissions/${id}/quote`, { method: 'PATCH', body })),
  sendQuote: (id: number) => request<unknown>(`/commissions/${id}/quote/send`, { method: 'POST' }),
  transition: (id: number, body: TransitionRequest) =>
    request<unknown>(`/commissions/${id}/transitions`, { method: 'POST', body }),
  refund: (id: number, body: RefundRequest) =>
    data(
      request<ApiResponse<Payment>>(`/admin/commissions/${id}/refunds`, { method: 'POST', body }),
    ),
  donations: (query: { page?: number; status?: DonationStatus }, signal?: AbortSignal) =>
    request<PaginatedResponse<AdminDonation>>('/admin/donations', { query, signal }),
  markDonationsPaid: (body: MarkDonationsPaidRequest) =>
    data(
      request<ApiResponse<AdminDonation[]>>('/admin/donations/mark-paid', {
        method: 'POST',
        body,
      }),
    ),
  monthlyReport: (year: number, signal?: AbortSignal) =>
    data(
      request<ApiResponse<MonthlyReportRow[]>>('/admin/reports/monthly', {
        query: { year },
        signal,
      }),
    ),
};

/** The monthly report as a CSV file: a plain link the browser downloads with the session. */
export const monthlyReportCsvUrl = (year: number) =>
  `${API_BASE}/admin/reports/monthly.csv?year=${year}`;

/** A commission's files (milestone 10): reference photos, previews, and final files. */
export const filesApi = {
  list: (commissionId: number, signal?: AbortSignal) =>
    request<FilesResponse>(`/commissions/${commissionId}/files`, { signal }),
  uploadReference: (commissionId: number, file: File) =>
    data(
      upload<ApiResponse<CommissionFile>>(
        `/commissions/${commissionId}/files/references`,
        file,
        file.name,
      ),
    ),
  remove: (commissionId: number, fileId: number) =>
    request<void>(`/commissions/${commissionId}/files/${fileId}`, { method: 'DELETE' }),
  /** Admin: a work-in-progress image; the server watermarks it. */
  uploadPreview: (commissionId: number, file: File) =>
    data(
      upload<ApiResponse<CommissionFile>>(
        `/admin/commissions/${commissionId}/files/previews`,
        file,
        file.name,
      ),
    ),
  /** Admin: the deliverable, stored exactly as uploaded. */
  uploadFinal: (commissionId: number, file: File) =>
    data(
      upload<ApiResponse<CommissionFile>>(
        `/admin/commissions/${commissionId}/files/finals`,
        file,
        file.name,
      ),
    ),
};

/**
 * The admin screens (milestone 9): commissions with their clients, quotes, money, tree
 * donations, and the monthly report. Only the admin ever receives these.
 */
import type { Commission, CommissionDetails } from './commission.ts';

/** The client behind a commission; null once they deleted their account (ADR 0012). */
export interface AdminClient {
  id: number;
  displayName: string;
  email: string;
}

/** GET /admin/commissions: a commission with who asked for it. */
export interface AdminCommissionRow extends Commission {
  client: AdminClient | null;
}

export interface QuoteLineItem {
  code: string;
  label: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'superseded';

/** A commission's current quote (GET /commissions/:id/quote; drafts are admin-only). */
export interface Quote {
  id: number;
  commissionId: number;
  computedAmountCents: number;
  adjustedAmountCents: number | null;
  adjustmentNote: string | null;
  lineItems: QuoteLineItem[];
  status: QuoteStatus;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The adjusted amount if there is one, else the computed amount. */
  totalCents: number;
  depositCents: number;
  balanceCents: number;
}

/** PATCH /commissions/:id/quote: change a draft's price, with the reason. */
export interface AdjustQuoteRequest {
  adjustedAmountCents: number;
  adjustmentNote: string;
}

/** POST /commissions/:id/transitions. */
export interface TransitionRequest {
  toStatus: string;
  reason?: string;
}

/**
 * Where a commission's money stands, for the refund form: what came in, what went back,
 * what went to trees (never refunded, ADR 0013), and what can still be refunded.
 */
export interface CommissionMoney {
  paidCents: number;
  /** Refunds that succeeded or are still processing. */
  refundedCents: number;
  withheldForTreesCents: number;
  refundableCents: number;
  /** Tree money given back anyway (a refund made in the Stripe Dashboard); 0 normally. */
  treeMoneyRefundedCents: number;
  /** The commission's tree donation, once fully paid. */
  trees: { count: number; status: DonationStatus } | null;
}

/** GET /admin/commissions/:id. */
export interface AdminCommissionDetails {
  commission: CommissionDetails;
  client: AdminClient | null;
  money: CommissionMoney;
}

export type DonationStatus = 'pending' | 'owed' | 'paid' | 'reversed';

/** GET /admin/donations: one commission's trees. */
export interface AdminDonation {
  id: number;
  commissionId: number;
  treeCount: number | null;
  amountCents: number;
  status: DonationStatus;
  /** When Digital Humani accepted the request (owed from then on). */
  requestedAt: string | null;
  treeRequestId: string | null;
  /** The day the owner paid the planting partner's invoice (YYYY-MM-DD). */
  payoutDate: string | null;
  receiptReference: string | null;
  createdAt: string;
}

/** POST /admin/donations/mark-paid: one invoice usually covers several commissions. */
export interface MarkDonationsPaidRequest {
  donationIds: number[];
  /** YYYY-MM-DD, not in the future. */
  payoutDate: string;
  receiptReference: string;
}

/**
 * GET /admin/reports/monthly: one row per month (New York time, ADR 0015), in cents.
 * Sales count deposits and final payments by the day they were started.
 */
export interface MonthlyReportRow {
  /** YYYY-MM. */
  month: string;
  salesCents: number;
  /** The part of sales that paid for shipping and packaging (milestone 11). */
  shippingCents: number;
  refundsCents: number;
  netSalesCents: number;
  treesOrdered: number;
  treesOrderedCents: number;
  donationsPaidCents: number;
  /** Tree money owed to the planting partner at the end of the month. */
  donationsOwedAtMonthEndCents: number;
}

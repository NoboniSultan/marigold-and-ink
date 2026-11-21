export type FulfillmentType = 'digital' | 'physical' | 'mixed_media';

export type CommissionStatus =
  | 'inquiry'
  | 'quoted'
  | 'deposit_paid'
  | 'in_progress'
  | 'revision'
  | 'awaiting_final_payment'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'canceled'
  | 'refunded';

/**
 * What the commission form may offer, derived from the active pricing rules (no prices).
 * Only size + medium pairs in `combinations` can be requested.
 */
export interface CommissionOptions {
  combinations: { size: string; medium: string }[];
  fulfillmentTypes: FulfillmentType[];
  /** False when no price exists for extra subjects, so only one subject can be requested. */
  multipleSubjects: boolean;
  rushAvailable: boolean;
}

export interface CommissionRequest {
  size: string;
  medium: string;
  subjectCount: number;
  fulfillmentType: FulfillmentType;
  isRush: boolean;
  notes?: string;
}

export interface Commission {
  id: number;
  clientId: number;
  size: string;
  medium: string;
  subjectCount: number;
  fulfillmentType: FulfillmentType;
  isRush: boolean;
  notes: string | null;
  status: CommissionStatus;
  revisionCount: number;
  revisionLimit: number;
  quotedTotalCents: number | null;
  depositCents: number | null;
  balanceCents: number | null;
  createdAt: string;
  updatedAt: string;
}

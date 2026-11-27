/** Shipping a physical commission (milestone 11, ADR 0017). United States only. */

export interface ShippingAddress {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  /** Two-letter code, e.g. "NY". */
  state: string;
  /** "10001" or "10001-1234". */
  postalCode: string;
}

/** What the client or admin sends to set the address. */
export type ShippingAddressInput = Omit<ShippingAddress, 'line2'> & { line2?: string | null };

/** The package, in ounces and inches. */
export interface ShippingPackage {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

/** A shipping option the client can choose, priced by the shipping service. */
export interface ShippingOption {
  rateId: string;
  carrier: string;
  serviceName: string;
  estimatedDays: number | null;
  postageCents: number;
  packagingFeeCents: number;
  /** Postage plus packaging: what the final payment adds. */
  totalCents: number;
}

/** Where a package is, as the carrier reports it (milestone 11b). */
export type TrackingStatus =
  | 'unknown'
  | 'pre_transit'
  | 'transit'
  | 'delivered'
  | 'returned'
  | 'failure';

/** One carrier scan. The place is the carrier facility's town, never the delivery address. */
export interface TrackingEvent {
  status: TrackingStatus;
  details: string | null;
  occurredAt: string | null;
  city: string | null;
  state: string | null;
}

/** The postage label in use, with its tracking. */
export interface ShippingLabel {
  carrier: string;
  serviceName: string;
  trackingNumber: string;
  /** The carrier's tracking page, when it has one. */
  trackingUrl: string | null;
  trackingStatus: TrackingStatus;
  trackingDetails: string | null;
  trackingUpdatedAt: string | null;
  /** The carrier's estimated delivery, when it gives one. */
  eta: string | null;
  createdAt: string;
  /** Newest first. */
  events: TrackingEvent[];
  /** What the postage cost the studio. Admin only (null for clients). */
  postageCents: number | null;
  /** Can the admin void it now (bought, not yet scanned by the carrier)? Always false for clients. */
  voidable: boolean;
}

/** A voided label and its refund (admin only). */
export interface VoidedLabel {
  trackingNumber: string;
  postageCents: number;
  voidedAt: string;
  /** The shipping service's answer: queued and pending can take up to two weeks. */
  refundStatus: 'queued' | 'pending' | 'success' | 'error';
}

export interface Shipment {
  /** Null until the client enters it, and after it was removed (see addressRemovedAt). */
  address: ShippingAddress | null;
  /** When the address was removed because the client deleted their account, or null. */
  addressRemovedAt: string | null;
  /** Null until the owner enters it. */
  package: ShippingPackage | null;
  /** The option the client chose, or null. */
  chosen: Omit<ShippingOption, 'rateId'> | null;
  /** The label in use, or null until one is bought. */
  label: ShippingLabel | null;
  /** Labels voided earlier. Admin only (always empty for clients). */
  voidedLabels: VoidedLabel[];
}

/** A price for buying the label (admin only), for the service the client chose or another. */
export interface LabelOption {
  rateId: string;
  carrier: string;
  serviceName: string;
  estimatedDays: number | null;
  /** Today's postage. */
  postageCents: number;
  /** The postage the client paid, or null if they paid for a different service. */
  paidPostageCents: number | null;
  /** Is this the service the client chose? */
  matchesChoice: boolean;
}

export interface ShippingMeta {
  /** False until shipping is configured; physical commissions can't take the final payment. */
  shippingEnabled: boolean;
  /** True for physical commissions; digital and mixed-media work is delivered as files. */
  ships: boolean;
  /** Can the address and package change now (from the deposit until the final payment)? */
  addressOpen: boolean;
  /** Can the client get prices and choose an option now (while the final payment is due)? */
  choosingOpen: boolean;
  /** Can the admin buy a label now (paid, no label in use)? Always false for clients. */
  labelOpen: boolean;
}

export interface ShippingResponse {
  data: Shipment | null;
  meta: ShippingMeta;
}

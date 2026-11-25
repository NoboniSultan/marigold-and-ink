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

export interface Shipment {
  /** Null until the client enters it, and after it was removed (see addressRemovedAt). */
  address: ShippingAddress | null;
  /** When the address was removed because the client deleted their account, or null. */
  addressRemovedAt: string | null;
  /** Null until the owner enters it. */
  package: ShippingPackage | null;
  /** The option the client chose, or null. */
  chosen: Omit<ShippingOption, 'rateId'> | null;
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
}

export interface ShippingResponse {
  data: Shipment | null;
  meta: ShippingMeta;
}

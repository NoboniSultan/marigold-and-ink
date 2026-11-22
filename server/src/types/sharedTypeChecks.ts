/**
 * Compile-time checks that shared/types (what the client sees) match the server's own
 * definitions. Nothing here runs: if a status or type is added on one side only,
 * `npm run typecheck` fails on the line below that compares them.
 */
import type {
  CommissionStatus as SharedStatus,
  FulfillmentType as SharedFulfillment,
} from '@shared/types/commission.ts';
import type {
  PaymentStatus as SharedPaymentStatus,
  PaymentType as SharedPaymentType,
} from '@shared/types/payment.ts';
import type { CommissionStatus } from '../modules/commissions/commissions.stateMachine.ts';
import type { FulfillmentType } from '../modules/pricing/pricing.engine.ts';
import type { PaymentStatus, PaymentType } from '../modules/payments/payments.repository.ts';

/** `true` only when A and B are exactly the same union. */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const statusesMatch: Equals<CommissionStatus, SharedStatus> = true;
export const fulfillmentTypesMatch: Equals<FulfillmentType, SharedFulfillment> = true;
export const paymentTypesMatch: Equals<PaymentType, SharedPaymentType> = true;
export const paymentStatusesMatch: Equals<PaymentStatus, SharedPaymentStatus> = true;

import type { OrderStatus } from '@shared/types/order.ts';

/** What each order status means to the person reading it. */
export const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  pending_payment: 'Waiting for payment',
  paid: 'Paid',
  expired: 'Not paid (the payment page closed)',
  canceled: 'Canceled',
  refunded: 'Refunded',
};

/** Every order status, for the admin's filter. */
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_TEXT) as OrderStatus[];

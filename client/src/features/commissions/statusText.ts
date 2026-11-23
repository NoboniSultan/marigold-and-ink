import type { CommissionStatus } from '@shared/types/commission.ts';

/** One line per status, for the client: on a commission's page and in the account list. */
export const STATUS_TEXT: Record<CommissionStatus, string> = {
  inquiry: 'Request received. A quote is on its way.',
  quoted: 'Quoted. The deposit starts the work.',
  deposit_paid: 'Deposit paid. Work starts soon.',
  in_progress: 'In progress.',
  revision: 'A revision is in progress.',
  awaiting_final_payment: 'Final design approved. The balance is due.',
  ready_to_ship: 'Paid in full. Getting ready to ship.',
  shipped: 'Shipped.',
  delivered: 'Delivered.',
  completed: 'Completed.',
  canceled: 'Cancelled.',
  refunded: 'Refunded.',
};

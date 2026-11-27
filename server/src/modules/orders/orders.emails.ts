/**
 * The order confirmation email (milestone 12b). The wording is the owner's: until it's
 * written it reads PLACEHOLDER, and in production an email with a placeholder isn't sent
 * (see orders.service.ts). The order's lines and total are filled in by the code.
 */
import { buildEmail } from '../../lib/emailText.ts';
import { formatCents } from '../../lib/money.js';

export const ORDER_EMAIL_COPY = {
  confirmation: {
    subject: 'PLACEHOLDER: subject of the order confirmation email',
    lines: ['PLACEHOLDER: the opening of the order confirmation email.'],
    /** For a local pickup instead of the shipping line: how it's arranged. */
    pickup: 'PLACEHOLDER: how a local pickup is arranged.',
  },
} as const;

export function orderConfirmationEmail(
  to: string,
  order: {
    id: number;
    items: { productName: string; variantName: string; quantity: number; lineCents: number }[];
    shippingCents: number;
    pickup: boolean;
    totalCents: number;
    pageUrl: string;
  },
) {
  const copy = ORDER_EMAIL_COPY.confirmation;
  return buildEmail(to, copy.subject, [
    ...copy.lines,
    `Order #${order.id}:`,
    ...order.items.map(
      (item) =>
        `${item.quantity} × ${item.productName} (${item.variantName}): ${formatCents(item.lineCents)}`,
    ),
    order.pickup ? copy.pickup : `Shipping & packaging: ${formatCents(order.shippingCents)}`,
    `Total: ${formatCents(order.totalCents)}`,
    `Your order: ${order.pageUrl}`,
  ]);
}

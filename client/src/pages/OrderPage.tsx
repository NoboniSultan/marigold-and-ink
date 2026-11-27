import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { useOrder } from '../api/queries.ts';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import { useCart } from '../features/cart/CartContext.tsx';
import { ORDER_STATUS_TEXT } from '../features/orders/orderFormat.ts';
import { usd } from '../features/shop/shopFormat.ts';
import { AddressLines, TrackingPart, describeOption } from '../features/shipping/Shipping.tsx';
import { COPY } from '../content/copy.ts';
import adminStyles from './admin/Admin.module.css';
import styles from './CartPage.module.css';

const POLL_MS = 2000;
/** Stripe's confirmation normally arrives within seconds; stop asking after a minute. */
const CONFIRM_FOR_MS = 60_000;

/**
 * One order (/orders/:id, milestone 12b). Stripe sends the client back here after paying
 * (?payment=success): the cart is emptied, and the page checks every few seconds until the
 * payment is confirmed (Stripe's webhook can arrive a moment after the client does).
 */
export function OrderPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const returned = params.get('payment') === 'success';
  const { clear } = useCart();
  const [gaveUp, setGaveUp] = useState(false);

  // Back from Stripe: the cart has been bought, and the confirmation is waited for.
  useEffect(() => {
    if (!returned) return;
    clear();
    const timer = setTimeout(() => setGaveUp(true), CONFIRM_FOR_MS);
    return () => clearTimeout(timer);
  }, [returned, clear]);

  const [waiting, setWaiting] = useState(returned);
  const order = useOrder(id, { pollMs: waiting && !gaveUp ? POLL_MS : false });
  // Adjusting state during render when derived data changes (React's documented pattern).
  if (waiting && order.data && order.data.status !== 'pending_payment') setWaiting(false);

  if (order.isPending) return <Loading label="Loading your order" />;
  if (order.isError) {
    const missing = order.error instanceof ApiError && [403, 404].includes(order.error.status);
    return missing ? (
      <section className={styles.page}>
        <h1>Order not found</h1>
        <p>
          We couldn&apos;t find this order. <Link to="/account">See your orders</Link>.
        </p>
      </section>
    ) : (
      <ErrorMessage message="Your order couldn't load." onRetry={() => order.refetch()} />
    );
  }
  const o = order.data;
  const pending = o.status === 'pending_payment';

  return (
    <section className={styles.page}>
      <h1>Order #{o.id}</h1>
      {returned && o.status === 'paid' && (
        <p className={styles.notice} role="status">
          Thank you! Your payment went through.
        </p>
      )}
      {returned && pending && (
        <p className={styles.notice} role="status">
          {gaveUp
            ? "We haven't heard from the payment service yet. This page will show it once we do; you can check back later."
            : 'Confirming your payment…'}
        </p>
      )}
      <p>
        <strong>{ORDER_STATUS_TEXT[o.status]}</strong>
        {o.paidAt
          ? `, ${new Date(o.paidAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}`
          : ''}
      </p>

      <div className={adminStyles.tableWrap}>
        <table className={adminStyles.table}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col" className={adminStyles.number}>
                Quantity
              </th>
              <th scope="col" className={adminStyles.number}>
                Price
              </th>
            </tr>
          </thead>
          <tbody>
            {o.items.map((item) => (
              <tr key={item.variantId}>
                <td>
                  {item.productName} ({item.variantName})
                </td>
                <td className={adminStyles.number}>{item.quantity}</td>
                <td className={adminStyles.number}>{usd(item.lineCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {!o.pickup && (
              <tr>
                <td colSpan={2}>Shipping &amp; packaging</td>
                <td className={adminStyles.number}>{usd(o.shippingCents)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={2}>Total</td>
              <td className={adminStyles.number}>{usd(o.totalCents)}</td>
            </tr>
            {o.refundedCents > 0 && (
              <tr>
                <td colSpan={2}>Refunded</td>
                <td className={adminStyles.number}>{usd(o.refundedCents)}</td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {o.pickup ? (
        <p className={styles.notice}>
          <strong>{o.status === 'delivered' ? 'Picked up.' : 'Local pickup.'}</strong>{' '}
          {o.status === 'delivered' ? '' : COPY.shop.pickupNote}
        </p>
      ) : o.shipment ? (
        <section aria-labelledby="order-shipping-heading">
          <h2 id="order-shipping-heading">Shipping</h2>
          {o.shipment.address && <AddressLines address={o.shipment.address} />}
          {o.shipment.chosen && <p>{describeOption(o.shipment.chosen)}.</p>}
          {o.shipment.label && <TrackingPart label={o.shipment.label} />}
        </section>
      ) : null}

      {pending && !returned && o.checkoutUrl && (
        <div className={styles.actions}>
          <a href={o.checkoutUrl} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
            Return to payment
          </a>
          {o.checkoutExpiresAt && (
            <span className={styles.muted}>
              Open until{' '}
              {new Date(o.checkoutExpiresAt).toLocaleTimeString('en-US', { timeStyle: 'short' })}
            </span>
          )}
        </div>
      )}
      <p>
        <Link to="/account">Your orders</Link> · <Link to="/shop">The shop</Link>
      </p>
    </section>
  );
}

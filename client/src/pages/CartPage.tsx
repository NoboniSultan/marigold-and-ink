import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError, formMessage } from '../api/client.ts';
import { ordersApi } from '../api/endpoints.ts';
import { useCartPreview } from '../api/queries.ts';
import { useAuth } from '../auth/AuthContext.tsx';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import { useCart } from '../features/cart/CartContext.tsx';
import { goTo } from '../features/cart/goTo.ts';
import { CartShipping, type ShippingChoice } from '../features/cart/CartShipping.tsx';
import { COPY } from '../content/copy.ts';
import { usd } from '../features/shop/shopFormat.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import styles from './CartPage.module.css';

/** How many of an item the quantity menu offers: up to what's in stock (at most 20 listed). */
function quantityChoices(available: number, current: number) {
  const top = Math.max(current, Math.min(available, 20));
  return Array.from({ length: Math.max(1, top) }, (_, i) => i + 1);
}

/**
 * The cart (/cart, milestone 12b): each item priced by the server, quantities to change,
 * and checkout. Checking out needs an account (owner decision, 2026-11-27); a visitor is
 * sent to log in and comes back here.
 */
export function CartPage() {
  const { user } = useAuth();
  const cart = useCart();
  const [params] = useSearchParams();
  const preview = useCartPreview(cart.lines);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Items that are gone (deleted or hidden) leave the cart, with a note. The count is
  // adjusted during render when the list changes (React's documented pattern); the cart
  // itself is updated in an effect.
  const unavailable = preview.data?.unavailable ?? [];
  const unavailableKey = unavailable.join(',');
  const [seen, setSeen] = useState('');
  const [dropped, setDropped] = useState(0);
  if (unavailableKey && unavailableKey !== seen) {
    setSeen(unavailableKey);
    setDropped(dropped + unavailable.length);
  }
  const { remove } = cart;
  useEffect(() => {
    if (unavailableKey) remove(unavailableKey.split(',').map(Number));
  }, [unavailableKey, remove]);

  // Shipping (milestone 12c): the address and service chosen in the shipping step.
  const [shippingChoice, setShippingChoice] = useState<ShippingChoice | null>(null);
  const [shippingReset, setShippingReset] = useState(0);
  const cartKey = cart.lines.map((l) => `${l.variantId}x${l.quantity}`).join(',');
  // A changed cart is packed and priced again: the earlier choice no longer applies.
  const [choiceForCart, setChoiceForCart] = useState(cartKey);
  if (choiceForCart !== cartKey) {
    setChoiceForCart(cartKey);
    setShippingChoice(null);
  }

  if (preview.error instanceof ApiError && preview.error.status === 404) return <NotFoundPage />;

  async function checkout() {
    setStarting(true);
    setError(null);
    try {
      const { url } = await ordersApi.checkout({
        items: cart.lines,
        ...(shippingChoice
          ? {
              shipping: {
                address: shippingChoice.address,
                serviceToken: shippingChoice.option.serviceToken,
                expectedCents: shippingChoice.option.totalCents,
              },
            }
          : {}),
      });
      goTo(url);
    } catch (err) {
      setError(err);
      setStarting(false);
      if (err instanceof ApiError && err.code === 'OUT_OF_STOCK') void preview.refetch();
      if (
        err instanceof ApiError &&
        ['SHIPPING_PRICE_CHANGED', 'SHIPPING_OPTION_STALE'].includes(err.code)
      ) {
        setShippingChoice(null);
        setShippingReset((n) => n + 1);
      }
    }
  }

  const data = preview.data;
  return (
    <section className={styles.page}>
      <h1>Your cart</h1>
      {params.get('checkout') === 'cancelled' && (
        <p className={styles.notice} role="status">
          Checkout was cancelled. Your items are still in your cart.
        </p>
      )}
      {dropped > 0 && (
        <p className={styles.notice} role="status">
          {dropped === 1 ? 'An item is' : 'Some items are'} no longer available and{' '}
          {dropped === 1 ? 'was' : 'were'} removed from your cart.
        </p>
      )}

      {cart.lines.length === 0 ? (
        <p>
          Your cart is empty. <Link to="/shop">Visit the shop</Link>.
        </p>
      ) : preview.isPending ? (
        <Loading label="Loading your cart" />
      ) : preview.isError ? (
        <ErrorMessage message="Your cart couldn't load." onRetry={() => preview.refetch()} />
      ) : data ? (
        <>
          <ul className={styles.lines} aria-label="Items">
            {data.lines.map((line) => (
              <li key={line.variantId} className={styles.line} aria-label={line.productName}>
                {line.photo ? (
                  <img src={line.photo.smallUrl} alt="" className={styles.thumb} />
                ) : (
                  <span className={styles.thumb} />
                )}
                <div>
                  <Link to={`/shop/${line.productSlug}`} className={styles.name}>
                    {line.productName}
                  </Link>
                  <div className={styles.muted}>
                    {line.variantName}, {usd(line.unitPriceCents)} each
                  </div>
                  {!line.ok && (
                    <p className={styles.problem} role="alert">
                      {line.available === 0
                        ? 'Sold out.'
                        : `Only ${line.available} left. Lower the quantity to check out.`}
                    </p>
                  )}
                  <div className={styles.controls}>
                    <label>
                      <span className="visually-hidden">Quantity of {line.productName}</span>
                      <select
                        className={styles.quantity}
                        value={line.quantity}
                        onChange={(e) => cart.setQuantity(line.variantId, Number(e.target.value))}
                      >
                        {quantityChoices(line.available, line.quantity).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => cart.remove([line.variantId])}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <span className={styles.amount}>{usd(line.lineCents)}</span>
              </li>
            ))}
          </ul>
          <p className={styles.total}>
            <span>Subtotal</span>
            <span className={styles.amount}>{usd(data.subtotalCents)}</span>
          </p>
          {data.delivery === 'pickup' && (
            <p className={styles.notice}>
              <strong>Local pickup.</strong> {COPY.shop.pickupNote}
            </p>
          )}
          {data.delivery === 'unavailable' && (
            <p className={styles.problem} role="alert">
              Some items can&apos;t be shipped yet. Please contact us about this order.
            </p>
          )}
          {user && data.delivery === 'ship' && (
            <CartShipping
              key={cartKey}
              lines={cart.lines}
              onChoose={setShippingChoice}
              resetKey={shippingReset}
            />
          )}
          {shippingChoice && (
            <>
              <p className={styles.line2}>
                <span>Shipping &amp; packaging</span>
                <span className={styles.amount}>{usd(shippingChoice.option.totalCents)}</span>
              </p>
              <p className={styles.total}>
                <span>Total</span>
                <span className={styles.amount}>
                  {usd(data.subtotalCents + shippingChoice.option.totalCents)}
                </span>
              </p>
            </>
          )}
          {error ? (
            <p className={styles.problem} role="alert">
              {formMessage(error)}
            </p>
          ) : null}
          <div className={styles.actions}>
            {user ? (
              <button
                type="button"
                className={`${buttonStyles.button} ${buttonStyles.primary}`}
                onClick={checkout}
                disabled={
                  !data.ready ||
                  starting ||
                  data.delivery === 'unavailable' ||
                  (data.delivery === 'ship' && !shippingChoice)
                }
              >
                {starting ? 'Opening the payment page…' : 'Check out'}
              </button>
            ) : (
              <Link
                to="/login?next=/cart"
                className={`${buttonStyles.button} ${buttonStyles.primary}`}
              >
                Log in to check out
              </Link>
            )}
            <Link to="/shop">Keep shopping</Link>
          </div>
          <p className={styles.muted}>
            You pay on Stripe&apos;s secure page. Your items are held for 30 minutes while you pay.
          </p>
        </>
      ) : null}
    </section>
  );
}

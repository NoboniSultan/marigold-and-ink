import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { useShopProduct, useShopStatus } from '../api/queries.ts';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import { COPY } from '../content/copy.ts';
import { ProductImage } from '../features/shop/ProductImage.tsx';
import { soldText, usd } from '../features/shop/shopFormat.ts';
import { useCart } from '../features/cart/CartContext.tsx';
import buttonStyles from '../components/Button.module.css';
import { NotFoundPage } from './NotFoundPage.tsx';
import styles from './ProductPage.module.css';

/** A product's page (/shop/:slug): photos, options with their prices, and the details. */
export function ProductPage() {
  const { slug = '' } = useParams();
  const { data: product, isPending, error, refetch } = useShopProduct(slug);
  const status = useShopStatus();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [variantId, setVariantId] = useState<number | null>(null);
  // What's typed, kept as text so the box can be emptied while typing; read on adding.
  const [quantityText, setQuantityText] = useState('1');
  const quantity = Math.max(1, Math.min(100, Math.floor(Number(quantityText)) || 1));
  const [added, setAdded] = useState<string | null>(null);
  const cart = useCart();

  if (isPending) return <Loading label="Loading product" />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error)
    return <ErrorMessage message="This product couldn't load." onRetry={() => refetch()} />;

  const photo = product.photos[photoIndex] ?? product.photos[0];
  // The chosen option, or the first one in stock (or simply the first).
  const variant =
    product.variants.find((v) => v.id === variantId) ??
    product.variants.find((v) => v.available) ??
    product.variants[0];
  const sold = soldText(product);
  const paragraphs = product.description.split(/\n\s*\n/).filter((p) => p.trim());

  return (
    <article className={styles.page}>
      <Link to={`/shop?category=${product.category}`} className={styles.back}>
        ← {COPY.shop.categories[product.category]}
      </Link>
      {status.data && !status.data.open && (
        <p className={styles.preview} role="note">
          Preview: the shop is only visible to you until it opens (SHOP_OPEN).
        </p>
      )}
      <div className={styles.layout}>
        <div className={styles.photos}>
          {photo && (
            <ProductImage
              photo={photo}
              sizes="(min-width: 64rem) 44rem, 100vw"
              priority
              className={styles.main}
            />
          )}
          {product.photos.length > 1 && (
            <ul className={styles.thumbs} aria-label="Photos">
              {product.photos.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={styles.thumb}
                    aria-pressed={p.id === photo?.id}
                    aria-label={`Photo ${i + 1} of ${product.photos.length}`}
                    onClick={() => setPhotoIndex(i)}
                  >
                    <img src={p.smallUrl} alt="" loading="lazy" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.details}>
          <h1>{product.name}</h1>
          <p className={styles.price}>
            {variant ? usd(variant.priceCents) : null}
            {sold ? (
              <span className={styles.sold}>{sold}</span>
            ) : variant && !variant.available ? (
              <span className={styles.sold}>Sold out</span>
            ) : null}
          </p>

          {product.variants.length > 1 && (
            <fieldset className={styles.options}>
              <legend>Options</legend>
              {product.variants.map((v) => (
                <label key={v.id} className={styles.option}>
                  <input
                    type="radio"
                    name="variant"
                    value={v.id}
                    checked={v.id === variant?.id}
                    onChange={() => setVariantId(v.id)}
                  />
                  <span>
                    {v.name}: {usd(v.priceCents)}
                    {v.available ? '' : ' (sold out)'}
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {variant && variant.available && (
            <div className={styles.buy}>
              {!product.oneOfAKind && (
                <label className={styles.quantityLabel}>
                  Quantity
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={quantityText}
                    onChange={(e) => setQuantityText(e.target.value)}
                    className={styles.quantity}
                  />
                </label>
              )}
              <button
                type="button"
                className={`${buttonStyles.button} ${buttonStyles.primary}`}
                onClick={() => {
                  cart.add(variant.id, product.oneOfAKind ? 1 : quantity);
                  setAdded(variant.name);
                }}
              >
                Add to cart
              </button>
            </div>
          )}
          {added && (
            <p className={styles.added} role="status">
              Added to your cart. <Link to="/cart">View cart</Link>
            </p>
          )}

          {paragraphs.map((text, i) => (
            <p key={i}>{text}</p>
          ))}

          <dl className={styles.facts}>
            {product.materials && (
              <>
                <dt>Materials</dt>
                <dd>{product.materials}</dd>
              </>
            )}
            {product.dimensions && (
              <>
                <dt>Size</dt>
                <dd>{product.dimensions}</dd>
              </>
            )}
            <dt>Category</dt>
            <dd>{COPY.shop.categories[product.category]}</dd>
          </dl>
        </div>
      </div>
    </article>
  );
}

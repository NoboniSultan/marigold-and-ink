import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api/client.ts';
import { useShopProducts, useShopStatus } from '../api/queries.ts';
import { ErrorMessage, Loading } from '../components/Loading.tsx';
import buttonStyles from '../components/Button.module.css';
import { COPY } from '../content/copy.ts';
import { ProductImage } from '../features/shop/ProductImage.tsx';
import { CATEGORIES, isCategory, priceText, soldText } from '../features/shop/shopFormat.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import styles from './ShopPage.module.css';

/**
 * The shop (/shop, milestone 12a): products by category (?category, ?page in the URL, so a
 * filtered view can be shared). Until the shop opens, only the admin can see it.
 */
export function ShopPage() {
  const [params] = useSearchParams();
  const raw = params.get('category');
  const category = isCategory(raw) ? raw : undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const status = useShopStatus();
  const list = useShopProducts({ category, page });

  if (list.error instanceof ApiError && list.error.status === 404) return <NotFoundPage />;

  const link = (changes: { category?: string; page?: number }) => {
    const next = new URLSearchParams();
    const c = 'category' in changes ? changes.category : category;
    if (c) next.set('category', c);
    if (changes.page && changes.page > 1) next.set('page', String(changes.page));
    const query = next.toString();
    return `/shop${query ? `?${query}` : ''}`;
  };
  const meta = list.data?.meta;
  const lastPage = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.heading}>{COPY.shop.title}</h1>
        <p className={styles.intro}>{COPY.shop.intro}</p>
      </header>

      {status.data && !status.data.open && (
        <p className={styles.preview} role="note">
          Preview: the shop is only visible to you until it opens (SHOP_OPEN).
        </p>
      )}

      <nav aria-label="Shop categories" className={styles.chips}>
        <Link
          to={link({ category: undefined })}
          className={styles.chip}
          aria-current={!category ? 'page' : undefined}
        >
          All
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            to={link({ category: c })}
            className={styles.chip}
            aria-current={category === c ? 'page' : undefined}
          >
            {COPY.shop.categories[c]}
          </Link>
        ))}
      </nav>

      {list.isPending && <Loading label="Loading the shop" />}
      {list.isError && (
        <ErrorMessage message="The shop couldn't load." onRetry={() => list.refetch()} />
      )}
      {list.data &&
        (list.data.data.length === 0 ? (
          <p>{COPY.shop.empty}</p>
        ) : (
          <ul className={styles.grid} aria-label="Products">
            {list.data.data.map((product) => {
              const sold = soldText(product);
              return (
                <li key={product.slug}>
                  <Link to={`/shop/${product.slug}`} className={styles.card}>
                    <div className={styles.frame}>
                      {product.photo && (
                        <ProductImage
                          photo={product.photo}
                          sizes="(min-width: 64rem) 16rem, (min-width: 32rem) 45vw, 100vw"
                        />
                      )}
                      {sold && <span className={styles.badge}>{sold}</span>}
                    </div>
                    <span className={styles.name}>{product.name}</span>
                    <span className={styles.price}>{priceText(product)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}

      {meta && lastPage > 1 && (
        <nav aria-label="Pages" className={styles.pager}>
          {page > 1 && (
            <Link
              to={link({ page: page - 1 })}
              className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            >
              Previous
            </Link>
          )}
          <span>
            Page {page} of {lastPage}
          </span>
          {page < lastPage && (
            <Link
              to={link({ page: page + 1 })}
              className={`${buttonStyles.button} ${buttonStyles.secondary}`}
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

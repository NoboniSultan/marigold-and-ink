import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ProductCategory } from '@shared/types/shop.ts';
import { fieldErrors, formMessage } from '../../api/client.ts';
import { adminShopApi } from '../../api/endpoints.ts';
import { queryKeys, useAdminProducts } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import { COPY } from '../../content/copy.ts';
import { CATEGORIES, isCategory, priceText, productState } from '../../features/shop/shopFormat.ts';
import { PackingTypes } from '../../features/shop/PackingTypes.tsx';
import styles from './Admin.module.css';

function NewProductForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ProductCategory | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fields = fieldErrors(error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const product = await adminShopApi.create({
        name,
        category: category as ProductCategory,
        description: '',
        materials: null,
        dimensions: null,
        oneOfAKind: false,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.admin });
      navigate(`/admin/shop/${product.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-label="New product" noValidate>
      <h3>New product</h3>
      {error ? (
        <p className={styles.error} role="alert">
          {formMessage(error)}
        </p>
      ) : null}
      <FormField
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fields.name}
        maxLength={120}
        required
      />
      <label className={styles.label}>
        Category
        <select
          className={styles.select}
          value={category}
          onChange={(e) => setCategory(e.target.value as ProductCategory | '')}
          required
        >
          <option value="">Choose…</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {COPY.shop.categories[c]}
            </option>
          ))}
        </select>
        {fields.category && <span className={styles.error}>{fields.category}</span>}
      </label>
      <button
        type="submit"
        className={`${buttonStyles.button} ${buttonStyles.primary}`}
        disabled={saving}
      >
        {saving ? 'Creating…' : 'Create product'}
      </button>
      <p className={styles.muted}>
        It starts as a draft. Add its options, photos, and details next, then publish it.
      </p>
    </form>
  );
}

/** The shop's products (milestone 12a), drafts included; filter by category (?category). */
export function AdminShopPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('category');
  const category = isCategory(raw) ? raw : undefined;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useAdminProducts({ category, page });
  const meta = list.data?.meta;
  const lastPage = meta ? Math.max(1, Math.ceil(meta.total / meta.pageSize)) : 1;

  function update(changes: Record<string, string | null>) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  }

  return (
    <>
      <section className={styles.section} aria-labelledby="products-heading">
        <h2 id="products-heading">Shop products</h2>
        <div className={styles.toolbar}>
          <label className={styles.label}>
            Category
            <select
              className={styles.select}
              value={category ?? ''}
              onChange={(e) => update({ category: e.target.value || null, page: null })}
            >
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {COPY.shop.categories[c]}
                </option>
              ))}
            </select>
          </label>
          <Link to="/shop">View the shop</Link>
        </div>

        {list.isPending && <Loading label="Loading products" />}
        {list.isError && (
          <ErrorMessage message="The products couldn't load." onRetry={() => list.refetch()} />
        )}
        {list.data &&
          (list.data.data.length === 0 ? (
            <p>No products{category ? ' in this category' : ''} yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">Category</th>
                    <th scope="col" className={styles.number}>
                      Price
                    </th>
                    <th scope="col" className={styles.number}>
                      Stock
                    </th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.data.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/admin/shop/${p.id}`}>{p.name}</Link>
                        {p.oneOfAKind ? ' (one of a kind)' : ''}
                      </td>
                      <td>{COPY.shop.categories[p.category]}</td>
                      <td className={styles.number}>
                        {p.variants.length > 0 ? priceText(p) : '–'}
                      </td>
                      <td className={styles.number}>{p.stock}</td>
                      <td>{productState(p)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {meta && lastPage > 1 && (
          <div className={styles.pager}>
            <button
              type="button"
              className={`${buttonStyles.button} ${buttonStyles.secondary}`}
              disabled={page <= 1}
              onClick={() => update({ page: String(page - 1) })}
            >
              Previous
            </button>
            <span>
              Page {page} of {lastPage}
            </span>
            <button
              type="button"
              className={`${buttonStyles.button} ${buttonStyles.secondary}`}
              disabled={page >= lastPage}
              onClick={() => update({ page: String(page + 1) })}
            >
              Next
            </button>
          </div>
        )}
      </section>
      <section className={styles.section} aria-label="Add a product">
        <NewProductForm />
      </section>
      <PackingTypes />
    </>
  );
}

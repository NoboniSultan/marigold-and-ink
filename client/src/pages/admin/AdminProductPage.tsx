import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminProduct, AdminVariant, ProductCategory } from '@shared/types/shop.ts';
import { ApiError, fieldErrors, formMessage } from '../../api/client.ts';
import { adminShopApi } from '../../api/endpoints.ts';
import { queryKeys, useAdminProduct } from '../../api/queries.ts';
import { FormField } from '../../components/FormField.tsx';
import { ErrorMessage, Loading } from '../../components/Loading.tsx';
import buttonStyles from '../../components/Button.module.css';
import pageStyles from '../SimplePage.module.css';
import { COPY } from '../../content/copy.ts';
import { dollarsToCents } from '../../features/admin/adminFormat.ts';
import { CATEGORIES, productState, usd } from '../../features/shop/shopFormat.ts';
import { NotFoundPage } from '../NotFoundPage.tsx';
import styles from './Admin.module.css';

const primary = `${buttonStyles.button} ${buttonStyles.primary}`;
const secondary = `${buttonStyles.button} ${buttonStyles.secondary}`;

/**
 * Runs a change to the product: every change answers with the whole product, which goes
 * straight into the cache (and the list is refreshed). Errors are kept to show.
 */
function useProductChange(productId: number) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run(change: () => Promise<AdminProduct>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(queryKeys.adminProduct(productId), await change());
      await queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

function Problem({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className={styles.error} role="alert">
      {formMessage(error)}
    </p>
  );
}

// --- Details ---

function DetailsForm({ product }: { product: AdminProduct }) {
  const { run, busy, error } = useProductChange(product.id);
  const descriptionId = useId();
  const [form, setForm] = useState({
    name: product.name,
    slug: product.slug,
    category: product.category,
    description: product.description,
    materials: product.materials ?? '',
    dimensions: product.dimensions ?? '',
    oneOfAKind: product.oneOfAKind,
  });
  const [saved, setSaved] = useState(false);
  const fields = fieldErrors(error);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(() =>
      adminShopApi.update(product.id, {
        ...form,
        materials: form.materials || null,
        dimensions: form.dimensions || null,
      }),
    );
    setSaved(ok);
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-label="Product details" noValidate>
      <h3>Details</h3>
      <Problem error={error} />
      <FormField
        label="Name"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        error={fields.name}
        maxLength={120}
        required
      />
      <FormField
        label="Web address"
        hint={`noboni.art/shop/${form.slug || '…'}`}
        value={form.slug}
        onChange={(e) => set('slug', e.target.value)}
        error={fields.slug}
        maxLength={120}
        required
      />
      <label className={styles.label}>
        Category
        <select
          className={styles.select}
          value={form.category}
          onChange={(e) => set('category', e.target.value as ProductCategory)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {COPY.shop.categories[c]}
            </option>
          ))}
        </select>
      </label>
      <div className={pageStyles.field}>
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          rows={6}
          maxLength={5000}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <span className={pageStyles.hint}>A blank line starts a new paragraph.</span>
      </div>
      <FormField
        label="Materials (optional)"
        value={form.materials}
        onChange={(e) => set('materials', e.target.value)}
        error={fields.materials}
        maxLength={500}
      />
      <FormField
        label="Size (optional)"
        value={form.dimensions}
        onChange={(e) => set('dimensions', e.target.value)}
        error={fields.dimensions}
        maxLength={200}
      />
      <label className={pageStyles.choice}>
        <input
          type="checkbox"
          checked={form.oneOfAKind}
          onChange={(e) => set('oneOfAKind', e.target.checked)}
        />
        <span>One of a kind (a single option with a stock of 0 or 1; shown as Sold once sold)</span>
      </label>
      <button type="submit" className={primary} disabled={busy}>
        {busy ? 'Saving…' : 'Save details'}
      </button>
      {saved && (
        <p className={styles.status} role="status">
          Saved.
        </p>
      )}
    </form>
  );
}

// --- Publishing ---

function PublishPart({ product }: { product: AdminProduct }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { run, busy, error } = useProductChange(product.id);
  const [deleteError, setDeleteError] = useState<unknown>(null);

  async function remove() {
    if (!window.confirm(`Delete "${product.name}" with its options and photos?`)) return;
    setDeleteError(null);
    try {
      await adminShopApi.remove(product.id);
      queryClient.removeQueries({ queryKey: queryKeys.adminProduct(product.id) });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'products'] });
      navigate('/admin/shop');
    } catch (err) {
      setDeleteError(err);
    }
  }

  return (
    <div className={styles.form}>
      <p className={styles.status}>
        <strong>{productState(product)}</strong>
      </p>
      <Problem error={error ?? deleteError} />
      <div className={styles.actions}>
        {product.published ? (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => run(() => adminShopApi.update(product.id, { published: false }))}
          >
            Hide from the shop
          </button>
        ) : (
          <button
            type="button"
            className={primary}
            disabled={busy || product.missing.length > 0}
            onClick={() => run(() => adminShopApi.update(product.id, { published: true }))}
          >
            Publish
          </button>
        )}
        <Link className={secondary} to={`/shop/${product.slug}`}>
          View in the shop
        </Link>
        <button type="button" className={secondary} onClick={remove}>
          Delete product
        </button>
      </div>
    </div>
  );
}

// --- Options and stock ---

function VariantRow({ product, variant }: { product: AdminProduct; variant: AdminVariant }) {
  const { run, busy, error } = useProductChange(product.id);
  const [name, setName] = useState(variant.name);
  const [price, setPrice] = useState((variant.priceCents / 100).toFixed(2));
  const [stock, setStock] = useState(String(variant.stock));
  const [reason, setReason] = useState<'restock' | 'adjustment'>('restock');
  const [note, setNote] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  async function saveOption(event: FormEvent) {
    event.preventDefault();
    const priceCents = dollarsToCents(price);
    if (priceCents === null || priceCents === 0) {
      setPriceError('Enter a price, like 4.50');
      return;
    }
    setPriceError(null);
    await run(() => adminShopApi.updateVariant(variant.id, { name, priceCents }));
  }

  async function saveStock(event: FormEvent) {
    event.preventDefault();
    const ok = await run(() =>
      adminShopApi.setStock(variant.id, { stock: Number(stock), reason, note: note || null }),
    );
    if (ok) setNote('');
  }

  function remove() {
    if (!window.confirm(`Delete the option "${variant.name}"?`)) return;
    void run(() => adminShopApi.removeVariant(variant.id));
  }

  return (
    <li className={styles.section} aria-label={`Option ${variant.name}`}>
      <Problem error={error} />
      <form className={styles.toolbar} onSubmit={saveOption} aria-label="Name and price">
        <FormField
          label="Option"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
        <FormField
          label="Price ($)"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={priceError ?? undefined}
        />
        <button type="submit" className={secondary} disabled={busy}>
          Save
        </button>
      </form>
      <form className={styles.toolbar} onSubmit={saveStock} aria-label="Stock">
        <FormField
          label={`Stock (now ${variant.stock})`}
          type="number"
          min={0}
          step={1}
          value={stock}
          onChange={(e) => setStock(e.target.value)}
        />
        <label className={styles.label}>
          Why
          <select
            className={styles.select}
            value={reason}
            onChange={(e) => setReason(e.target.value as 'restock' | 'adjustment')}
          >
            <option value="restock">Restock</option>
            <option value="adjustment">Adjustment (count, damage, gift…)</option>
          </select>
        </label>
        <FormField
          label="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
        <button type="submit" className={secondary} disabled={busy}>
          Set stock
        </button>
      </form>
      <div>
        <button type="button" className={styles.linkButton} onClick={remove} disabled={busy}>
          Delete option
        </button>
      </div>
    </li>
  );
}

function AddVariantForm({ product }: { product: AdminProduct }) {
  const { run, busy, error } = useProductChange(product.id);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState(product.oneOfAKind ? '1' : '');
  const [priceError, setPriceError] = useState<string | null>(null);
  const fields = fieldErrors(error);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const priceCents = dollarsToCents(price);
    if (priceCents === null || priceCents === 0) {
      setPriceError('Enter a price, like 4.50');
      return;
    }
    setPriceError(null);
    const ok = await run(() =>
      adminShopApi.addVariant(product.id, { name, priceCents, stock: Number(stock) || 0 }),
    );
    if (ok) {
      setName('');
      setPrice('');
      setStock('');
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-label="Add an option" noValidate>
      <h3>Add an option</h3>
      <Problem error={error} />
      <FormField
        label="Option name"
        hint="What the customer chooses, e.g. a pack size or colour. A product with no choices still has one."
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fields.name}
        maxLength={80}
        required
      />
      <FormField
        label="Price ($)"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        error={priceError ?? fields.priceCents}
        required
      />
      <FormField
        label="Stock"
        type="number"
        min={0}
        step={1}
        value={stock}
        onChange={(e) => setStock(e.target.value)}
        error={fields.stock}
      />
      <button type="submit" className={primary} disabled={busy}>
        {busy ? 'Adding…' : 'Add option'}
      </button>
    </form>
  );
}

// --- Photos ---

function PhotoRow({ product, index }: { product: AdminProduct; index: number }) {
  const photo = product.photos[index]!;
  const { run, busy, error } = useProductChange(product.id);
  const [alt, setAlt] = useState(photo.altText ?? '');
  const ids = product.photos.map((p) => p.id);

  function move(by: -1 | 1) {
    const next = [...ids];
    [next[index], next[index + by]] = [next[index + by]!, next[index]!];
    void run(() => adminShopApi.reorderPhotos(product.id, next));
  }

  function remove() {
    if (!window.confirm('Delete this photo?')) return;
    void run(() => adminShopApi.removePhoto(photo.id));
  }

  return (
    <li className={styles.section} aria-label={`Photo ${index + 1}`}>
      <Problem error={error} />
      <div className={styles.toolbar}>
        <img src={photo.smallUrl} alt="" className={styles.photo} />
        <form
          className={styles.toolbar}
          aria-label="Alt text"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => adminShopApi.setAltText(photo.id, alt || null));
          }}
        >
          <FormField
            label={index === 0 ? 'Alt text (cover photo)' : 'Alt text'}
            hint="What the photo shows, for people using screen readers."
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            maxLength={300}
          />
          <button type="submit" className={secondary} disabled={busy}>
            Save
          </button>
        </form>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.linkButton}
          disabled={busy || index === 0}
          onClick={() => move(-1)}
        >
          Move earlier
        </button>
        <button
          type="button"
          className={styles.linkButton}
          disabled={busy || index === ids.length - 1}
          onClick={() => move(1)}
        >
          Move later
        </button>
        <button type="button" className={styles.linkButton} disabled={busy} onClick={remove}>
          Delete photo
        </button>
      </div>
    </li>
  );
}

function PhotoUpload({ product }: { product: AdminProduct }) {
  const { run, busy, error } = useProductChange(product.id);
  const inputId = useId();
  return (
    <div className={styles.form}>
      <Problem error={error} />
      <div className={pageStyles.field}>
        <label htmlFor={inputId}>Add a photo (JPEG, PNG, or WebP, up to 20 MB)</label>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) await run(() => adminShopApi.uploadPhoto(product.id, file));
          }}
        />
        <span className={pageStyles.hint}>
          {busy
            ? 'Uploading…'
            : 'Location and camera details are removed. The first photo is the cover.'}
        </span>
      </div>
    </div>
  );
}

// --- The page ---

/** One product: details, publishing, options and stock, and photos (milestone 12a). */
export function AdminProductPage() {
  const id = Number(useParams().id);
  const { data: product, isPending, error, refetch } = useAdminProduct(id);

  if (isPending) return <Loading label="Loading product" />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error) {
    return <ErrorMessage message="This product couldn't load." onRetry={() => refetch()} />;
  }

  return (
    <>
      <Link to="/admin/shop">← All products</Link>
      <section className={styles.section} aria-labelledby="product-heading">
        <h2 id="product-heading">{product.name}</h2>
        <PublishPart product={product} />
      </section>

      <section className={styles.section} aria-labelledby="options-heading">
        <h2 id="options-heading">Options and stock</h2>
        {product.variants.length > 0 && (
          <ul className={styles.list}>
            {product.variants.map((v) => (
              <VariantRow
                key={`${v.id}-${v.name}-${v.priceCents}-${v.stock}`}
                product={product}
                variant={v}
              />
            ))}
          </ul>
        )}
        {!(product.oneOfAKind && product.variants.length > 0) && (
          <AddVariantForm product={product} />
        )}
        {product.variants.length > 0 && (
          <p className={styles.muted}>
            Prices from {usd(Math.min(...product.variants.map((v) => v.priceCents)))}. Every stock
            change is logged with its reason.
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="photos-heading">
        <h2 id="photos-heading">Photos</h2>
        {product.photos.length > 0 && (
          <ul className={styles.list}>
            {product.photos.map((p, i) => (
              <PhotoRow key={`${p.id}-${i}-${p.altText}`} product={product} index={i} />
            ))}
          </ul>
        )}
        {product.photos.length < 10 && <PhotoUpload product={product} />}
      </section>

      <section className={styles.section} aria-label="Details">
        <DetailsForm key={product.updatedAt} product={product} />
      </section>
    </>
  );
}

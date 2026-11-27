/**
 * Test factories: insert a valid row with sensible defaults, let each test override
 * only the fields it cares about, and return the inserted row.
 *
 *   const client = await createUser();
 *   const commission = await createCommission({ clientId: client.id, status: 'quoted' });
 *
 * Factories write SQL directly because they are test fixtures, not application code.
 * Default values here are arbitrary test data, not business prices or limits.
 */
import { pool } from '../../src/db/pool.js';
import { hashPassword } from '../../src/lib/password.js';

/** Default password for users created with createUserWithPassword(). */
export const TEST_PASSWORD = 'correct horse battery staple';

let sequence = 0;
const next = () => ++sequence;

/** Inserts `row` (camelCase keys) into `table` and returns the inserted row. */
async function insert(table, row) {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  const placeholders = entries.map((_, i) => `$${i + 1}`);
  const { rows } = await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    entries.map(([, value]) => value),
  );
  return rows[0];
}

export function createUser(overrides = {}) {
  const n = next();
  return insert('users', {
    email: `user${n}@example.com`,
    passwordHash: '$2b$10$fakehashfortestsonlyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    displayName: `Test User ${n}`,
    role: 'client',
    // Every account created through the app has a verified email (signup code or Google).
    emailVerifiedAt: new Date(),
    ...overrides,
  });
}

/** Links a Google account to a user: createIdentity({ userId, providerUserId: 'google-sub-1' }). */
export function createIdentity(overrides = {}) {
  const n = next();
  return insert('auth_identities', {
    provider: 'google',
    providerUserId: `google-sub-${n}`,
    ...overrides,
  });
}

/**
 * A user who can actually log in (real bcrypt hash; tests use the minimum cost for speed).
 * @param {{ password?: string } & Record<string, unknown>} [options] plus any users column
 */
export async function createUserWithPassword({ password = TEST_PASSWORD, ...overrides } = {}) {
  const user = await createUser({ ...overrides, passwordHash: await hashPassword(password) });
  return { ...user, password };
}

/** Defaults to an unpublished artwork; pass `isPublished: true` (it has alt text already). */
export function createArtwork(overrides = {}) {
  const n = next();
  return insert('artworks', {
    title: `Artwork ${n}`,
    slug: `artwork-${n}`,
    category: 'test-category',
    imageKey: `artwork-${n}`,
    thumbPath: `/media/artworks/artwork-${n}-600.test.webp`,
    thumbWidth: 600,
    thumbHeight: 800,
    largePath: `/media/artworks/artwork-${n}-2000.test.webp`,
    largeWidth: 1500,
    largeHeight: 2000,
    altText: `Test artwork ${n}`,
    ...overrides,
  });
}

export function createTag(overrides = {}) {
  const n = next();
  return insert('tags', { name: `Tag ${n}`, slug: `tag-${n}`, ...overrides });
}

/** Links existing artworks and tags: tagArtwork(artwork.id, tag.id). */
export async function tagArtwork(artworkId, tagId) {
  await pool.query('INSERT INTO artwork_tags (artwork_id, tag_id) VALUES ($1, $2)', [
    artworkId,
    tagId,
  ]);
}

export function createPricingRule(overrides = {}) {
  return insert('pricing_rules', {
    ruleType: 'base',
    size: 'test-size',
    medium: 'test-medium',
    amountCents: 1000,
    ...overrides,
  });
}

/** Defaults to an 'inquiry' commission (no amounts) owned by a new client. */
export async function createCommission(overrides = {}) {
  const clientId = overrides.clientId ?? (await createUser()).id;
  return insert('commissions', {
    size: 'test-size',
    medium: 'test-medium',
    subjectCount: 1,
    fulfillmentType: 'digital',
    revisionLimit: 2,
    ...overrides,
    clientId,
  });
}

/** A commission past the inquiry stage, with consistent amounts. */
export function createQuotedCommission(overrides = {}) {
  return createCommission({
    status: 'quoted',
    quotedTotalCents: 10000,
    depositCents: 5000,
    balanceCents: 5000,
    ...overrides,
  });
}

export async function createCommissionEvent(overrides = {}) {
  const commissionId = overrides.commissionId ?? (await createCommission()).id;
  return insert('commission_events', {
    toStatus: 'inquiry',
    actorType: 'system',
    ...overrides,
    commissionId,
  });
}

export async function createQuote(overrides = {}) {
  const commissionId = overrides.commissionId ?? (await createCommission()).id;
  return insert('quotes', {
    computedAmountCents: 10000,
    lineItems: JSON.stringify([{ label: 'test item', amount_cents: 10000 }]),
    ...overrides,
    commissionId,
  });
}

export async function createPayment(overrides = {}) {
  const n = next();
  const commissionId = overrides.commissionId ?? (await createQuotedCommission()).id;
  return insert('payments', {
    type: 'deposit',
    amountCents: 5000,
    currency: 'usd',
    status: 'succeeded',
    stripeCheckoutSessionId: `cs_test_${n}`,
    stripePaymentIntentId: `pi_test_${n}`,
    ...overrides,
    commissionId,
  });
}

/** A shipment row for a physical commission; full address and package unless overridden. */
export async function createShipment(overrides = {}) {
  const commissionId =
    overrides.commissionId ??
    (await createQuotedCommission({ status: 'in_progress', fulfillmentType: 'physical' })).id;
  return insert('shipments', {
    recipientName: 'Test Client',
    addressLine1: '1 Main St',
    city: 'Testville',
    state: 'NY',
    postalCode: '10001',
    weightOz: 12,
    lengthIn: 18,
    widthIn: 14,
    heightIn: 1,
    ...overrides,
    commissionId,
  });
}

/** A bought postage label (milestone 11b), on a new shipment unless one is given. */
export async function createShippingLabel(overrides = {}) {
  const n = next();
  const shipmentId = overrides.shipmentId ?? (await createShipment()).id;
  return insert('shipping_labels', {
    providerTransactionId: `txn_${n}`,
    carrier: 'USPS',
    serviceToken: 'usps_ground_advantage',
    serviceName: 'Ground Advantage',
    trackingNumber: `9400TEST${n}`,
    trackingUrl: `https://tools.usps.com/go/TrackConfirmAction?tLabels=9400TEST${n}`,
    postageCents: 758,
    ...overrides,
    shipmentId,
  });
}

/** A shop product (milestone 12a): unpublished, with no variants or photos, unless given. */
export function createProduct(overrides = {}) {
  const n = next();
  return insert('products', {
    slug: `test-product-${n}`,
    name: `Test Product ${n}`,
    category: 'stickers',
    ...overrides,
  });
}

/** One of the owner's mailers or boxes (milestone 12c). */
export function createPackingType(overrides = {}) {
  const n = next();
  return insert('packing_types', {
    name: `Test Box ${n}`,
    lengthIn: 12,
    widthIn: 9,
    heightIn: 2,
    weightOz: 3,
    ...overrides,
  });
}

/** A variant of a new product unless one is given. Stock is set directly (no log row). */
export async function createVariant(overrides = {}) {
  const productId = overrides.productId ?? (await createProduct()).id;
  const n = next();
  return insert('product_variants', {
    name: `Option ${n}`,
    priceCents: 500,
    stock: 3,
    ...overrides,
    productId,
  });
}

/** A photo row (no stored file) of a new product unless one is given. */
export async function createProductPhoto(overrides = {}) {
  const productId = overrides.productId ?? (await createProduct()).id;
  const hash = next().toString(16).padStart(16, '0');
  return insert('product_photos', {
    smallKey: `shop/products/${productId}/${hash}-small.webp`,
    largeKey: `shop/products/${productId}/${hash}-large.webp`,
    width: 1600,
    height: 1200,
    altText: 'A test photo',
    ...overrides,
    productId,
  });
}

/** A shop order (milestone 12b), pending payment, for a new client unless one is given. */
export async function createOrder(overrides = {}) {
  const clientId = overrides.clientId ?? (await createUser()).id;
  return insert('orders', { subtotalCents: 800, currency: 'usd', ...overrides, clientId });
}

/** A line of a new order (and a new variant) unless they're given. */
export async function createOrderItem(overrides = {}) {
  const orderId = overrides.orderId ?? (await createOrder()).id;
  const variantId = overrides.variantId ?? (await createVariant()).id;
  return insert('order_items', {
    productName: 'Test Product',
    variantName: 'Single',
    unitPriceCents: 400,
    quantity: 2,
    ...overrides,
    orderId,
    variantId,
  });
}

export function createCharity(overrides = {}) {
  const n = next();
  return insert('charities', { name: `Test Charity ${n}`, ...overrides });
}

export async function createDonation(overrides = {}) {
  const payment = overrides.paymentId
    ? { id: overrides.paymentId, commission_id: overrides.commissionId }
    : await createPayment();
  const charityId = overrides.charityId ?? (await createCharity()).id;
  return insert('donations', {
    percentage: 25,
    baseAmountCents: 5000,
    donationAmountCents: 1250,
    ...overrides,
    paymentId: payment.id,
    commissionId: overrides.commissionId ?? payment.commission_id,
    charityId,
  });
}

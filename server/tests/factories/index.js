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
    ...overrides,
  });
}

/** A user who can actually log in (real bcrypt hash; tests use the minimum cost for speed). */
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

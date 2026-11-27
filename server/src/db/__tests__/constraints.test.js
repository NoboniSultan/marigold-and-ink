import { describe, it, expect, beforeEach } from 'vitest';
import { pool } from '../pool.js';
import { truncateAllTables } from '../../../tests/setup/database.js';
import {
  createUser,
  createArtwork,
  createPricingRule,
  createCommission,
  createQuotedCommission,
  createCommissionEvent,
  createQuote,
  createPayment,
  createCharity,
  createDonation,
  createShipment,
} from '../../../tests/factories/index.js';

beforeEach(truncateAllTables);

// Postgres error codes (SQLSTATE) we expect constraints to raise.
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';

/** Asserts the promise fails with the given SQLSTATE and (optionally) named constraint. */
async function expectViolation(promise, code, constraint) {
  const err = await promise.then(
    () => null,
    (e) => e,
  );
  expect(err, 'expected the database to reject this').not.toBeNull();
  expect(err.code).toBe(code);
  if (constraint) expect(err.constraint).toBe(constraint);
}

describe('users', () => {
  it('rejects a duplicate email regardless of letter case', async () => {
    await createUser({ email: 'ana@example.com' });

    await expectViolation(
      createUser({ email: 'ANA@Example.com' }),
      UNIQUE_VIOLATION,
      'users_email_key',
    );
  });

  it('rejects an unknown role', async () => {
    await expectViolation(createUser({ role: 'superuser' }), CHECK_VIOLATION, 'users_role_check');
  });

  it('rejects a malformed email', async () => {
    await expectViolation(
      createUser({ email: 'not-an-email' }),
      CHECK_VIOLATION,
      'users_email_format_check',
    );
  });

  it('updates updated_at automatically on every update', async () => {
    const user = await createUser();
    const { rows } = await pool.query(
      `UPDATE users SET display_name = 'Renamed', updated_at = '2000-01-01' WHERE id = $1 RETURNING updated_at`,
      [user.id],
    );

    // The trigger overrides even an explicit value, so updated_at can't be faked or forgotten.
    expect(rows[0].updated_at.getTime()).toBeGreaterThan(user.updated_at.getTime() - 1000);
    expect(rows[0].updated_at.getFullYear()).not.toBe(2000);
  });

  it('allows an anonymized (deleted) account, and several of them, with no email', async () => {
    const deleted = {
      email: null,
      passwordHash: null,
      emailVerifiedAt: null,
      displayName: 'Deleted user',
      deletedAt: new Date(),
    };
    await createUser(deleted);
    await expect(createUser(deleted)).resolves.toMatchObject({ email: null });
  });

  it('rejects a deleted account that keeps an email, password, or verification date', async () => {
    const deletedAt = new Date();
    for (const leftover of [
      { passwordHash: null, emailVerifiedAt: null }, // keeps the default email
      { email: null, emailVerifiedAt: null }, // keeps the password hash
      { email: null, passwordHash: null }, // keeps the verification date
      { email: null, passwordHash: null, emailVerifiedAt: null, role: 'admin' },
    ]) {
      await expectViolation(
        createUser({ deletedAt, ...leftover }),
        CHECK_VIOLATION,
        'users_deleted_fields_check',
      );
    }
  });

  it('rejects a live account without an email', async () => {
    await expectViolation(
      createUser({ email: null }),
      CHECK_VIOLATION,
      'users_deleted_fields_check',
    );
  });

  it('cannot be deleted while they own commissions', async () => {
    const commission = await createCommission();

    await expectViolation(
      pool.query('DELETE FROM users WHERE id = $1', [commission.client_id]),
      FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('email_verifications', () => {
  const code = (overrides = {}) =>
    pool.query(
      `INSERT INTO email_verifications (purpose, email, user_id, code_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '15 minutes')`,
      [
        overrides.purpose ?? 'signup',
        overrides.email ?? 'someone@example.com',
        overrides.userId ?? null,
        'c'.repeat(64),
      ],
    );

  it('rejects an unknown purpose', async () => {
    await expectViolation(
      code({ purpose: 'newsletter' }),
      CHECK_VIOLATION,
      'email_verifications_purpose_check',
    );
  });

  it('ties an email-change code, and only that, to an account', async () => {
    const user = await createUser();
    await expectViolation(
      code({ purpose: 'email_change' }),
      CHECK_VIOLATION,
      'email_verifications_user_check',
    );
    await expectViolation(
      code({ purpose: 'password_reset', userId: user.id }),
      CHECK_VIOLATION,
      'email_verifications_user_check',
    );
    await expect(code({ purpose: 'email_change', userId: user.id })).resolves.toBeDefined();
  });

  it('keeps one code per address and purpose, but allows each purpose its own', async () => {
    await code({ purpose: 'signup' });
    await expect(code({ purpose: 'password_reset' })).resolves.toBeDefined();
    await expectViolation(
      code({ purpose: 'signup' }),
      UNIQUE_VIOLATION,
      'email_verifications_pkey',
    );
  });

  it("rejects an email-change code for an account that doesn't exist", async () => {
    await expectViolation(
      code({ purpose: 'email_change', userId: 999999 }),
      FOREIGN_KEY_VIOLATION,
      'email_verifications_user_id_fkey',
    );
  });
});

describe('files', () => {
  const file = async (overrides = {}) => {
    const commission = await createCommission();
    return pool.query(
      `INSERT INTO files (commission_id, uploaded_by_user_id, kind, storage_key, original_filename,
                          content_type, size_bytes, width, height)
       VALUES ($1, $2, 'reference', $3, $4, 'image/jpeg', 10, $5, $6)`,
      [
        commission.id,
        commission.client_id,
        `key-${Math.random()}`,
        overrides.originalFilename ?? null,
        overrides.width ?? null,
        overrides.height ?? null,
      ],
    );
  };

  it('needs both image sizes or neither, and positive ones', async () => {
    await expectViolation(file({ width: 10 }), CHECK_VIOLATION, 'files_dimensions_check');
    await expectViolation(file({ width: 0, height: 5 }), CHECK_VIOLATION, 'files_dimensions_check');
    await expect(file({ width: 10, height: 5 })).resolves.toBeDefined();
  });

  it('keeps a plain file name: never a path, never empty, at most 200 characters', async () => {
    await expectViolation(
      file({ originalFilename: '../x.jpg' }),
      CHECK_VIOLATION,
      'files_original_filename_check',
    );
    await expectViolation(
      file({ originalFilename: 'a\\b.jpg' }),
      CHECK_VIOLATION,
      'files_original_filename_check',
    );
    await expectViolation(
      file({ originalFilename: '' }),
      CHECK_VIOLATION,
      'files_original_filename_check',
    );
    await expectViolation(
      file({ originalFilename: 'n'.repeat(201) }),
      CHECK_VIOLATION,
      'files_original_filename_check',
    );
    await expect(file({ originalFilename: 'Benito.jpg' })).resolves.toBeDefined();
  });
});

describe('artworks', () => {
  it('rejects a slug that is not URL-safe', async () => {
    await expectViolation(
      createArtwork({ slug: 'Not A Slug!' }),
      CHECK_VIOLATION,
      'artworks_slug_format_check',
    );
  });

  it('rejects a duplicate slug', async () => {
    await createArtwork({ slug: 'sunset' });

    await expectViolation(createArtwork({ slug: 'sunset' }), UNIQUE_VIOLATION, 'artworks_slug_key');
  });

  it('rejects two artworks sharing one image', async () => {
    await createArtwork({ imageKey: 'fawn' });

    await expectViolation(
      createArtwork({ imageKey: 'fawn' }),
      UNIQUE_VIOLATION,
      'artworks_image_key_key',
    );
  });

  it.each([
    ['an external URL', 'https://example.com/a.webp'],
    ['a non-WebP file', '/media/artworks/a.jpg'],
    ['path traversal', '/media/a/../../server/x.webp'],
    ['a path outside /media', '/etc/passwd.webp'],
  ])('rejects %s as an image path', async (_label, path) => {
    await expectViolation(
      createArtwork({ thumbPath: path }),
      CHECK_VIOLATION,
      'artworks_thumb_path_check',
    );
    await expectViolation(
      createArtwork({ largePath: path }),
      CHECK_VIOLATION,
      'artworks_large_path_check',
    );
  });

  it('rejects zero or negative image dimensions', async () => {
    await expectViolation(
      createArtwork({ largeHeight: 0 }),
      CHECK_VIOLATION,
      'artworks_image_dimensions_check',
    );
  });

  it('rejects publishing an artwork without alt text', async () => {
    await expectViolation(
      createArtwork({ isPublished: true, altText: null }),
      CHECK_VIOLATION,
      'artworks_published_alt_text_check',
    );
  });

  it('allows an unpublished draft without alt text', async () => {
    const draft = await createArtwork({ altText: null });

    expect(draft.alt_text).toBeNull();
  });

  it('rejects a content hash that is not a SHA-256 hex digest', async () => {
    await expectViolation(
      createArtwork({ contentHash: 'abc' }),
      CHECK_VIOLATION,
      'artworks_content_hash_check',
    );
  });

  it('rejects a year outside the sanity range', async () => {
    await expectViolation(createArtwork({ year: 20219 }), CHECK_VIOLATION, 'artworks_year_check');
  });

  it('keeps the search vector in sync with the row, weighting the title highest', async () => {
    const artwork = await createArtwork({
      title: 'Starry Night',
      credit: 'after Vincent van Gogh',
      medium: 'scratchboard',
    });
    await pool.query('UPDATE artworks SET medium = $1 WHERE id = $2', ['ink', artwork.id]);

    const { rows } = await pool.query(
      `SELECT search_vector @@ websearch_to_tsquery('english_unaccent', 'gogh') AS by_credit,
              search_vector @@ websearch_to_tsquery('english_unaccent', 'ink') AS by_new_medium,
              search_vector @@ websearch_to_tsquery('english_unaccent', 'scratchboard') AS by_old_medium,
              search_vector::text AS vector
         FROM artworks WHERE id = $1`,
      [artwork.id],
    );
    expect(rows[0]).toMatchObject({ by_credit: true, by_new_medium: true, by_old_medium: false });
    expect(rows[0].vector).toContain("'night':2A");
  });
});

describe('pricing_rules', () => {
  it('rejects a base rule without a medium', async () => {
    await expectViolation(
      createPricingRule({ ruleType: 'base', medium: null }),
      CHECK_VIOLATION,
      'pricing_rules_shape_check',
    );
  });

  it('rejects a rush rule tied to a size', async () => {
    await expectViolation(
      createPricingRule({ ruleType: 'rush', size: 'test-size', medium: null }),
      CHECK_VIOLATION,
      'pricing_rules_shape_check',
    );
  });

  it('rejects a negative amount', async () => {
    await expectViolation(
      createPricingRule({ amountCents: -1 }),
      CHECK_VIOLATION,
      'pricing_rules_amount_check',
    );
  });

  it('rejects an unknown fulfillment type', async () => {
    await expectViolation(
      createPricingRule({
        ruleType: 'fulfillment',
        size: null,
        medium: null,
        fulfillmentType: 'carrier_pigeon',
      }),
      CHECK_VIOLATION,
      'fulfillment_type_check',
    );
  });

  it('allows only one active rule per key, even when key fields are NULL', async () => {
    const rush = { ruleType: 'rush', size: null, medium: null };
    await createPricingRule(rush);

    await expectViolation(
      createPricingRule(rush),
      UNIQUE_VIOLATION,
      'pricing_rules_active_key_idx',
    );
    // Inactive rows (price history) are not limited.
    await expect(createPricingRule({ ...rush, isActive: false })).resolves.toBeDefined();
  });
});

describe('commissions', () => {
  it('rejects a status that is not a real state', async () => {
    await expectViolation(
      createCommission({ status: 'teleported' }),
      CHECK_VIOLATION,
      'commission_status_check',
    );
  });

  it('requires at least one subject', async () => {
    await expectViolation(
      createCommission({ subjectCount: 0 }),
      CHECK_VIOLATION,
      'commissions_subject_count_check',
    );
  });

  it('rejects more revisions than the limit allows', async () => {
    await expectViolation(
      createCommission({ revisionCount: 3, revisionLimit: 2 }),
      CHECK_VIOLATION,
      'commissions_revision_count_check',
    );
  });

  it('rejects negative amounts', async () => {
    await expectViolation(
      createQuotedCommission({ quotedTotalCents: 4000, depositCents: -1000, balanceCents: 5000 }),
      CHECK_VIOLATION,
      'commissions_amounts_check',
    );
  });

  it('rejects a deposit and balance that do not add up to the total', async () => {
    await expectViolation(
      createQuotedCommission({ quotedTotalCents: 10000, depositCents: 5000, balanceCents: 4999 }),
      CHECK_VIOLATION,
      'commissions_amounts_check',
    );
  });

  it('rejects a quoted commission with no price', async () => {
    await expectViolation(
      createCommission({ status: 'quoted' }),
      CHECK_VIOLATION,
      'commissions_quoted_amounts_present_check',
    );
  });

  it('rejects shipping states for digital-only work', async () => {
    await expectViolation(
      createQuotedCommission({ fulfillmentType: 'digital', status: 'ready_to_ship' }),
      CHECK_VIOLATION,
      'commissions_digital_not_shipped_check',
    );
    await expect(
      createQuotedCommission({ fulfillmentType: 'physical', status: 'ready_to_ship' }),
    ).resolves.toBeDefined();
  });
});

describe('commission_events', () => {
  it('cannot be updated or deleted (append-only audit trail)', async () => {
    const event = await createCommissionEvent();

    await expectViolation(
      pool.query(`UPDATE commission_events SET reason = 'edited' WHERE id = $1`, [event.id]),
      RESTRICT_VIOLATION,
    );
    await expectViolation(
      pool.query('DELETE FROM commission_events WHERE id = $1', [event.id]),
      RESTRICT_VIOLATION,
    );
  });

  it('requires a user for client/admin actors and forbids one for system actors', async () => {
    const user = await createUser();

    await expectViolation(
      createCommissionEvent({ actorType: 'admin', actorUserId: null }),
      CHECK_VIOLATION,
      'commission_events_actor_user_check',
    );
    await expectViolation(
      createCommissionEvent({ actorType: 'system', actorUserId: user.id }),
      CHECK_VIOLATION,
      'commission_events_actor_user_check',
    );
  });

  it('rejects an event that does not change the status', async () => {
    await expectViolation(
      createCommissionEvent({ fromStatus: 'quoted', toStatus: 'quoted' }),
      CHECK_VIOLATION,
      'commission_events_status_changes_check',
    );
  });
});

describe('quotes', () => {
  it('requires a note when the admin adjusts the price', async () => {
    await expectViolation(
      createQuote({ adjustedAmountCents: 9000, adjustmentNote: '  ' }),
      CHECK_VIOLATION,
      'quotes_adjustment_note_check',
    );
  });

  it('allows only one current quote per commission', async () => {
    const commission = await createCommission();
    const first = await createQuote({ commissionId: commission.id });

    await expectViolation(
      createQuote({ commissionId: commission.id }),
      UNIQUE_VIOLATION,
      'quotes_one_current_per_commission_idx',
    );

    // Superseding the old quote frees the slot for a revised one.
    await pool.query(`UPDATE quotes SET status = 'superseded' WHERE id = $1`, [first.id]);
    await expect(createQuote({ commissionId: commission.id })).resolves.toBeDefined();
  });

  it('requires sent_at once a quote is sent', async () => {
    await expectViolation(createQuote({ status: 'sent' }), CHECK_VIOLATION, 'quotes_sent_at_check');
  });
});

describe('payments', () => {
  it('rejects zero and negative amounts', async () => {
    await expectViolation(
      createPayment({ amountCents: 0 }),
      CHECK_VIOLATION,
      'payments_amount_check',
    );
    await expectViolation(
      createPayment({ amountCents: -500 }),
      CHECK_VIOLATION,
      'payments_amount_check',
    );
  });

  it('rejects recording the same Stripe Checkout session twice', async () => {
    await createPayment({ stripeCheckoutSessionId: 'cs_test_dup' });

    await expectViolation(
      createPayment({ stripeCheckoutSessionId: 'cs_test_dup' }),
      UNIQUE_VIOLATION,
      'payments_stripe_checkout_session_id_key',
    );
  });

  it('allows only one successful deposit per commission', async () => {
    const commission = await createQuotedCommission();
    await createPayment({ commissionId: commission.id, type: 'deposit', status: 'succeeded' });

    await expectViolation(
      createPayment({ commissionId: commission.id, type: 'deposit', status: 'succeeded' }),
      UNIQUE_VIOLATION,
      'payments_one_succeeded_per_stage_idx',
    );
    // Failed attempts are not limited.
    await expect(
      createPayment({ commissionId: commission.id, type: 'deposit', status: 'failed' }),
    ).resolves.toBeDefined();
  });

  it('requires a refund to reference the payment it refunds', async () => {
    await expectViolation(
      createPayment({ type: 'refund', stripeCheckoutSessionId: null, stripeRefundId: 're_1' }),
      CHECK_VIOLATION,
      'payments_refund_link_check',
    );
  });

  it('lets a refund share the payment intent of the payment it refunds', async () => {
    const deposit = await createPayment({ stripePaymentIntentId: 'pi_shared' });

    await expect(
      createPayment({
        commissionId: deposit.commission_id,
        type: 'refund',
        refundedPaymentId: deposit.id,
        stripeCheckoutSessionId: null,
        stripePaymentIntentId: 'pi_shared',
        stripeRefundId: 're_1',
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a lowercase-invalid currency code', async () => {
    await expectViolation(
      createPayment({ currency: 'USD' }),
      CHECK_VIOLATION,
      'payments_currency_check',
    );
  });

  it('keeps checkout fields on incoming payments and refund fields on refunds', async () => {
    const deposit = await createPayment();
    const refund = (overrides) =>
      createPayment({
        commissionId: deposit.commission_id,
        type: 'refund',
        refundedPaymentId: deposit.id,
        stripeCheckoutSessionId: null,
        stripeRefundId: null,
        ...overrides,
      });

    await expectViolation(
      refund({ checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
      CHECK_VIOLATION,
      'payments_checkout_fields_check',
    );
    await expectViolation(
      createPayment({ reason: 'not a refund' }),
      CHECK_VIOLATION,
      'payments_refund_fields_check',
    );
    await expectViolation(refund({ reason: '   ' }), CHECK_VIOLATION, 'payments_reason_check');
    await expect(refund({ reason: 'Client changed their mind' })).resolves.toBeDefined();
  });

  it('only stores https checkout URLs', async () => {
    await expectViolation(
      createPayment({ checkoutUrl: 'javascript:alert(1)' }),
      CHECK_VIOLATION,
      'payments_checkout_url_check',
    );
  });
});

describe('payments.shipping_cents', () => {
  it('is part of a final payment only, never negative, never more than the amount', async () => {
    await expect(
      createPayment({ type: 'final', amountCents: 6000, shippingCents: 1000 }),
    ).resolves.toBeDefined();
    for (const overrides of [
      { type: 'deposit', amountCents: 5000, shippingCents: 100 },
      { type: 'final', amountCents: 5000, shippingCents: -1 },
      { type: 'final', amountCents: 5000, shippingCents: 5001 },
    ]) {
      await expectViolation(
        createPayment(overrides),
        CHECK_VIOLATION,
        'payments_shipping_cents_check',
      );
    }
  });
});

describe('shipments', () => {
  const CHOICE = {
    providerShipmentId: 'shp_1',
    rateId: 'rate_1',
    carrier: 'USPS',
    serviceToken: 'usps_priority',
    serviceName: 'Priority Mail',
    postageCents: 1200,
    packagingFeeCents: 400,
    rateChosenAt: new Date(),
  };

  it('allows one shipment per commission', async () => {
    const first = await createShipment();
    await expectViolation(
      createShipment({ commissionId: first.commission_id }),
      UNIQUE_VIOLATION,
      'shipments_commission_id_key',
    );
  });

  it('ships within the US, to a real state code and ZIP', async () => {
    await expectViolation(
      createShipment({ country: 'CA' }),
      CHECK_VIOLATION,
      'shipments_country_check',
    );
    await expectViolation(
      createShipment({ state: 'ny' }),
      CHECK_VIOLATION,
      'shipments_state_check',
    );
    await expectViolation(
      createShipment({ postalCode: '1000' }),
      CHECK_VIOLATION,
      'shipments_postal_code_check',
    );
    await expect(createShipment({ postalCode: '10001-1234' })).resolves.toBeDefined();
  });

  it('keeps address text non-empty and short', async () => {
    await expectViolation(
      createShipment({ city: '' }),
      CHECK_VIOLATION,
      'shipments_address_text_check',
    );
    await expectViolation(
      createShipment({ recipientName: 'n'.repeat(101) }),
      CHECK_VIOLATION,
      'shipments_address_text_check',
    );
  });

  it('needs city, state, and ZIP together', async () => {
    await expectViolation(
      createShipment({ recipientName: null, addressLine1: null, city: null }),
      CHECK_VIOLATION,
      'shipments_locality_check',
    );
  });

  it('needs a name and first line with a locality, and a first line before a second', async () => {
    await expectViolation(
      createShipment({ recipientName: null }),
      CHECK_VIOLATION,
      'shipments_address_check',
    );
    await expectViolation(
      createShipment({ recipientName: null, addressLine1: null, addressLine2: 'Apt 4' }),
      CHECK_VIOLATION,
      'shipments_address_check',
    );
    await expectViolation(
      createShipment({ city: null, state: null, postalCode: null }),
      CHECK_VIOLATION,
      'shipments_address_check',
    );
    await expect(
      createShipment({
        recipientName: null,
        addressLine1: null,
        city: null,
        state: null,
        postalCode: null,
      }),
    ).resolves.toBeDefined(); // the package before the address
  });

  it('keeps only the locality once an address is removed', async () => {
    await expectViolation(
      createShipment({ addressRemovedAt: new Date() }),
      CHECK_VIOLATION,
      'shipments_address_check',
    );
    await expect(
      createShipment({
        recipientName: null,
        addressLine1: null,
        addressRemovedAt: new Date(),
        ...CHOICE,
      }),
    ).resolves.toBeDefined();
  });

  it('needs the whole package, with positive measures', async () => {
    await expectViolation(
      createShipment({ heightIn: null }),
      CHECK_VIOLATION,
      'shipments_parcel_check',
    );
    await expectViolation(
      createShipment({ weightOz: 0 }),
      CHECK_VIOLATION,
      'shipments_parcel_check',
    );
  });

  it('records a whole choice, made for a quote with an address and package', async () => {
    await expect(createShipment(CHOICE)).resolves.toBeDefined();
    await expectViolation(
      createShipment({ ...CHOICE, carrier: null }),
      CHECK_VIOLATION,
      'shipments_rate_check',
    );
    await expectViolation(
      createShipment({ ...CHOICE, providerShipmentId: null }),
      CHECK_VIOLATION,
      'shipments_rate_check',
    );
    await expectViolation(
      createShipment({ estimatedDays: 3 }),
      CHECK_VIOLATION,
      'shipments_rate_check',
    );
    await expectViolation(
      createShipment({ ...CHOICE, weightOz: null, lengthIn: null, widthIn: null, heightIn: null }),
      CHECK_VIOLATION,
      'shipments_rate_check',
    );
  });

  it('never records negative amounts or days', async () => {
    for (const change of [{ postageCents: -1 }, { packagingFeeCents: -1 }, { estimatedDays: -1 }]) {
      await expectViolation(
        createShipment({ ...CHOICE, ...change }),
        CHECK_VIOLATION,
        'shipments_rate_amounts_check',
      );
    }
  });

  it("can't be deleted out from under its commission", async () => {
    const shipment = await createShipment();
    await expectViolation(
      pool.query('DELETE FROM commissions WHERE id = $1', [shipment.commission_id]),
      FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('processed_webhook_events', () => {
  it('rejects the same Stripe event ID twice', async () => {
    const insert = () =>
      pool.query(
        `INSERT INTO processed_webhook_events (stripe_event_id, event_type) VALUES ('evt_1', 'checkout.session.completed')`,
      );
    await insert();

    await expectViolation(
      insert(),
      UNIQUE_VIOLATION,
      'processed_webhook_events_stripe_event_id_key',
    );
  });
});

describe('charities', () => {
  it('allows at most one active charity', async () => {
    await createCharity({ isActive: true });

    await expectViolation(
      createCharity({ isActive: true }),
      UNIQUE_VIOLATION,
      'charities_one_active_idx',
    );
    await expect(createCharity({ isActive: false })).resolves.toBeDefined();
  });
});

describe('donations', () => {
  // Tree donations (milestone 8): $1 a tree, requested through Digital Humani.
  const trees = { treeCount: 13, donationAmountCents: 1300 };

  it('accepts a pending tree donation, and an owed one with its request ID and time', async () => {
    await expect(createDonation(trees)).resolves.toMatchObject({ status: 'pending' });
    await expect(
      createDonation({ ...trees, status: 'owed', treeRequestId: 'req-1', requestedAt: new Date() }),
    ).resolves.toMatchObject({ status: 'owed' });
  });

  it('rejects zero trees', async () => {
    await expectViolation(
      createDonation({ treeCount: 0, donationAmountCents: 0 }),
      CHECK_VIOLATION,
      'donations_tree_count_check',
    );
  });

  it('rejects a tree donation that is not exactly $1 a tree', async () => {
    await expectViolation(
      createDonation({ treeCount: 13, donationAmountCents: 1250 }),
      CHECK_VIOLATION,
      'donations_tree_amount_check',
    );
  });

  it('rejects owed or paid trees without the time they were requested', async () => {
    await expectViolation(
      createDonation({ ...trees, status: 'owed' }),
      CHECK_VIOLATION,
      'donations_requested_fields_check',
    );
  });

  it('accepts owed trees without a request ID (a retry found them already counted)', async () => {
    await expect(
      createDonation({ ...trees, status: 'owed', requestedAt: new Date() }),
    ).resolves.toBeDefined();
  });

  it('rejects one Digital Humani request recorded twice', async () => {
    const requested = { ...trees, status: 'owed', treeRequestId: 'req-1', requestedAt: new Date() };
    await createDonation(requested);
    await expectViolation(
      createDonation(requested),
      UNIQUE_VIOLATION,
      'donations_tree_request_id_key',
    );
  });

  it('rejects a percentage above 100', async () => {
    await expectViolation(
      createDonation({ percentage: 100.01 }),
      CHECK_VIOLATION,
      'donations_percentage_check',
    );
  });

  it('rejects a donation larger than its base amount', async () => {
    await expectViolation(
      createDonation({ baseAmountCents: 1000, donationAmountCents: 1001 }),
      CHECK_VIOLATION,
      'donations_amounts_check',
    );
  });

  it('rejects negative amounts', async () => {
    await expectViolation(
      createDonation({ donationAmountCents: -1 }),
      CHECK_VIOLATION,
      'donations_amounts_check',
    );
  });

  it('allows only one donation per payment', async () => {
    const donation = await createDonation();

    await expectViolation(
      createDonation({ paymentId: donation.payment_id, commissionId: donation.commission_id }),
      UNIQUE_VIOLATION,
      'donations_payment_id_key',
    );
  });

  it('requires a payout date once marked paid', async () => {
    await expectViolation(
      createDonation({ status: 'paid' }),
      CHECK_VIOLATION,
      'donations_paid_has_payout_date_check',
    );
  });
});

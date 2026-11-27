# Data model

The schema is defined by the SQL migrations in [`server/src/db/migrations/`](../server/src/db/migrations/). This document explains it. If the two ever disagree, the migrations are the source of truth, and this file should be fixed.

## Conventions

| Convention | Why |
| --- | --- |
| `id bigint GENERATED ALWAYS AS IDENTITY` | Postgres's standard auto-increment. `ALWAYS` stops the app from inserting its own IDs by accident. `bigint` never runs out. |
| `created_at` / `updated_at timestamptz` | Always time-zone aware. `updated_at` is maintained by the `set_updated_at()` trigger, so code can't forget it or set it wrongly. |
| Money as `integer` cents, with a `_cents` suffix | No floating-point rounding errors. A 32-bit integer holds up to $21,474,836.47 per value. |
| Status columns as `text` + `CHECK` | Easy to change in a migration (unlike `ENUM`, whose values can't be removed). Lists used in several places are **domains** (`commission_status`, `fulfillment_type`): a named type that is `text` plus one shared `CHECK`. |
| Every constraint explicitly named | Tests assert exactly which rule fired, and error mapping can turn a constraint name into an API error code. |
| `ON DELETE RESTRICT` on anything tied to money or history | A user, commission, or payment that has history behind it can't be deleted. `CASCADE` is used only for the artwork↔tag join table. |
| Email as `citext` | Case-insensitive text, so `UNIQUE (email)` treats `Ana@x.com` and `ana@x.com` as the same address. |

## Entity-relationship diagram

```mermaid
erDiagram
    users ||--o{ commissions : "requests"
    users ||--o{ commission_events : "acts in (nullable: system)"
    users ||--o{ files : "uploads"
    users ||--o{ messages : "sends"
    users ||--o{ auth_identities : "signs in with"
    users |o--o{ payments : "requests refunds"

    artworks ||--o{ artwork_tags : "tagged with"
    tags ||--o{ artwork_tags : "applied to"

    commissions ||--o{ commission_events : "history"
    commissions ||--o{ quotes : "priced by"
    commissions ||--o{ payments : "paid by"
    commissions ||--o{ files : "has"
    commissions ||--o{ messages : "thread"
    commissions ||--o{ donations : "generates"
    commissions ||--o| shipments : "ships as"
    shipments ||--o{ shipping_labels : "labelled by (one in use)"
    shipping_labels ||--o{ tracking_events : "scanned"
    products ||--o{ product_variants : "sold as"
    products ||--o{ product_photos : "shown in"
    product_variants ||--o{ inventory_movements : "stock log"
    users |o--o{ inventory_movements : "changes stock"
    users ||--o{ orders : "places"
    orders ||--o{ order_items : "contains"
    product_variants ||--o{ order_items : "ordered as"
    orders ||--o{ order_events : "history"
    orders ||--o{ order_refunds : "refunded by"
    orders |o--o{ inventory_movements : "holds, releases, returns"
    orders ||--o| shipments : "ships as"
    packing_types |o--o{ products : "packed in"

    payments ||--o{ payments : "refunded by"
    payments ||--o| donations : "funds (one each)"
    charities ||--o{ donations : "receives"

    users {
        bigint id PK
        citext email UK "nullable: deleted"
        text password_hash "nullable: Google-only"
        text display_name
        text role "client | admin"
        timestamptz email_verified_at
        timestamptz deleted_at
    }
    auth_identities {
        bigint id PK
        bigint user_id FK
        text provider "google"
        text provider_user_id
        citext email
    }
    email_verifications {
        text purpose PK
        citext email PK
        bigint user_id FK
        text code_hash
        smallint attempts
        timestamptz expires_at
        timestamptz sent_at
    }
    artworks {
        bigint id PK
        text title
        text slug UK
        text description
        text medium
        text category
        smallint year
        text credit
        text alt_text
        text image_key UK
        text thumb_path
        int thumb_width
        int thumb_height
        text large_path
        int large_width
        int large_height
        boolean is_published
        int sort_order
        text content_hash
        tsvector search_vector "generated"
    }
    tags {
        bigint id PK
        text name
        text slug UK
    }
    artwork_tags {
        bigint artwork_id PK, FK
        bigint tag_id PK, FK
    }
    pricing_rules {
        bigint id PK
        text rule_type "base | extra_subject | rush | fulfillment"
        text size
        text medium
        fulfillment_type fulfillment_type
        int amount_cents
        boolean is_active
    }
    commissions {
        bigint id PK
        bigint client_id FK
        text size
        text medium
        int subject_count
        fulfillment_type fulfillment_type
        boolean is_rush
        text notes
        commission_status status
        int revision_count
        int revision_limit
        int quoted_total_cents
        int deposit_cents
        int balance_cents
    }
    commission_events {
        bigint id PK
        bigint commission_id FK
        commission_status from_status
        commission_status to_status
        text actor_type "client | admin | system"
        bigint actor_user_id FK
        text reason
        jsonb metadata
    }
    quotes {
        bigint id PK
        bigint commission_id FK
        int computed_amount_cents
        int adjusted_amount_cents
        text adjustment_note
        jsonb line_items
        text status "draft | sent | accepted | superseded"
        timestamptz sent_at
    }
    payments {
        bigint id PK
        bigint commission_id FK
        text type "deposit | final | refund"
        int amount_cents
        text currency
        text status "pending | succeeded | failed | expired"
        text stripe_checkout_session_id UK
        text stripe_payment_intent_id
        text stripe_refund_id UK
        bigint refunded_payment_id FK
        text checkout_url "deposit | final"
        timestamptz checkout_expires_at "deposit | final"
        text reason "refund"
        bigint requested_by_user_id FK "refund, admin"
    }
    processed_webhook_events {
        bigint id PK
        text stripe_event_id UK
        text event_type
        timestamptz processed_at
    }
    files {
        bigint id PK
        bigint commission_id FK
        bigint uploaded_by_user_id FK
        text kind "reference | preview | final"
        text storage_key UK
        text original_filename
        text content_type
        bigint size_bytes
    }
    messages {
        bigint id PK
        bigint commission_id FK
        bigint sender_user_id FK
        text body
        timestamptz read_at
    }
    charities {
        bigint id PK
        text name UK
        text description
        text website_url
        boolean is_active
    }
    donations {
        bigint id PK
        bigint payment_id FK, UK
        bigint commission_id FK
        bigint charity_id FK
        numeric percentage
        int base_amount_cents
        int donation_amount_cents
        text status "pending | owed | paid | reversed"
        date payout_date
        text receipt_reference
    }
    sessions {
        text sid PK
        jsonb sess "{ userId, cookie }"
        timestamptz expire
    }
```

`created_at` and `updated_at` are on every table and are omitted from the diagram. `commission_events` has only `created_at`, because events are never updated. `processed_webhook_events` uses `processed_at`. `sessions` follows the column layout required by the connect-pg-simple session store and has no relationships: the user ID lives inside `sess`.

## Tables, constraints, and indexes

### users

| Name | Type | Why |
| --- | --- | --- |
| `users_email_key` | UNIQUE (citext) | One account per email, case-insensitively. Also serves login lookups. |
| `users_email_format_check` | CHECK | A light sanity check (`x@y`, ≤ 254 chars). Real validation is in zod; this stops obvious garbage written by any path. |
| `users_display_name_check` | CHECK | 1 to 100 non-blank characters. |
| `users_role_check` | CHECK | Only `client` or `admin`, so a typo can't create an unknown role that authorization ignores. |
| `users_deleted_fields_check` | CHECK | A live account (`deleted_at` NULL) has an email. A deleted one has no email, password, or verification date, and is a client. Deletion can't leave personal data behind ([ADR 0012](decisions/0012-account-deletion-by-anonymization.md)). |

`password_hash` is nullable: accounts created with Google have no password, and login treats a missing hash exactly like a wrong password. `email_verified_at` records when the owner proved the email (a sign-up code or Google); `NULL` only for accounts from before milestone 5c, which can't log in until claimed with a code ([ADR 0010](decisions/0010-email-verification-and-google-sign-in.md)).

**Deleted accounts are anonymized, not removed** (milestone 7c): commissions and payments reference the row with `ON DELETE RESTRICT`, so it stays as "Deleted user" with `deleted_at` set. Every user query ignores these rows, and the email can sign up again as a new account.

### auth_identities, email_verifications

| Name | Type | Why |
| --- | --- | --- |
| `auth_identities_provider_user_key` | UNIQUE `(provider, provider_user_id)` | One Google account signs in to exactly one user. Users are matched on Google's permanent `sub`, never on email. |
| `auth_identities_user_provider_key` | UNIQUE `(user_id, provider)` | A user links at most one Google account. |
| `auth_identities_provider_check` | CHECK | Only `google` for now. |
| `auth_identities_provider_user_id_check` | CHECK | The provider's account ID is 1–255 characters, so an empty ID can never match. |
| `auth_identities.user_id` | FK, `ON DELETE CASCADE` | A sign-in method means nothing without its user and holds no money or history. |
| `email_verifications_pkey` | PRIMARY KEY `(purpose, email)` | At most one pending code per address and purpose (`signup`, `password_reset`, `email_change`): a new code replaces the old one ([ADR 0014](decisions/0014-password-reset-and-email-change.md), milestone 8d). |
| `email_verifications_purpose_check` | CHECK | Only the three purposes. |
| `email_verifications_user_check` | CHECK | An email-change code belongs to the account that asked for it (`user_id`); sign-up and reset codes are by address alone. |
| `email_verifications.user_id` | FK, `ON DELETE CASCADE` | A pending email change means nothing without its account. |
| `email_verifications_user_id_idx` | Partial index `(user_id) WHERE user_id IS NOT NULL` | Account deletion removes a user's pending email change; serves the foreign key too. |
| `email_verifications_expires_at_idx` | Index `(expires_at)` | Expired codes are deleted whenever a new one is issued. |
| `email_verifications_code_hash_check` | CHECK | A SHA-256 hex digest: only an HMAC of the code is stored, never the code. |
| `email_verifications_attempts_check` | CHECK | Never negative. Five wrong tries use a code up (enforced by the service). |

### artworks, tags, artwork_tags

| Name | Type | Why |
| --- | --- | --- |
| `artworks_slug_key`, `tags_slug_key` | UNIQUE | Slugs are public URLs (`/artworks/:slug`), so they must identify exactly one row. |
| `*_slug_format_check` | CHECK | Lowercase words joined by single hyphens; always URL-safe. |
| `artworks_title_check`, `artworks_category_check`, `tags_name_check` | CHECK | No blank names. |
| `artworks_image_key_key` | UNIQUE | One artwork per processed image. The key links the row to `media/manifest.json` and to its entry in `content/artworks.json`. |
| `artworks_image_key_format_check` | CHECK | Slug format, like every other key. |
| `artworks_thumb_path_check`, `artworks_large_path_check` | CHECK | Only app-served WebP files under `/media/`, and never `..`: no external URLs, no path traversal. |
| `artworks_image_dimensions_check` | CHECK | Widths and heights are positive. The client uses them to reserve space, so pages don't jump while images load. |
| `artworks_alt_text_check` | CHECK | Alt text, when present, is 1–300 characters. |
| `artworks_published_alt_text_check` | CHECK | `NOT is_published OR alt_text IS NOT NULL`: anything the public can see has a description for screen readers. Drafts may lack one. |
| `artworks_year_check` | CHECK | 1900–2100: a sanity range that catches typos, not a business rule. |
| `artworks_credit_check` | CHECK | Credit (e.g. "after Vincent van Gogh"), when present, is 1–200 characters. |
| `artworks_content_hash_check` | CHECK | A SHA-256 hex digest. Set on rows owned by `content/artworks.json`; NULL for rows created through the admin API. The seed rewrites a row only when this hash changes (see [ADR 0007](decisions/0007-content-files-and-media-pipeline.md)). |
| `search_vector` | Generated column (`STORED`) | `setweight(title, A) ‖ setweight(credit + medium + category, B) ‖ setweight(description, C)` in the `english_unaccent` configuration (a copy of `english` that runs the `unaccent` dictionary before stemming, so "guayasamin" matches "Guayasamín"; queries use the same configuration). Postgres recomputes it on every write, so search can never go stale. |
| `artworks_search_idx` | GIN index on `search_vector` | A **GIN** (generalized inverted) index maps each word stem to the rows containing it, so `search_vector @@ websearch_to_tsquery(...)` doesn't scan the table. |
| `is_monochrome` | Column (`boolean`, default false) | Black and white? Measured from the image by `npm run media` (stored in `media/manifest.json`); an entry in `content/artworks.json` can override it with `"monochrome"`. Black-and-white pieces come first in the grid, and the 3D view mixes them with coloured ones (milestone 7e). |
| `in_sketchbook` | Column (`boolean`, default true) | Shown in Explore's 3D sketchbook? Every published piece is in the grid; `"sketchbook": false` in `content/artworks.json` leaves a piece out of the book (milestone 8b). |
| `artworks_published_order_idx` | Partial index `(is_monochrome DESC, sort_order, id) WHERE is_published` | The public gallery's order: black and white first, then the owner's order. A **partial index** contains only the rows matching its `WHERE`, so it stays small. It replaced `artworks_published_sort_idx` (`sort_order, id`) in milestone 7e. |
| `artworks_published_category_idx` | Partial index `(category) WHERE is_published` | The gallery's category filter. |
| `artwork_tags` primary key | `(artwork_id, tag_id)` | Prevents tagging the same artwork twice, and serves "tags of this artwork" lookups. |
| `artwork_tags_tag_id_idx` | Index | "Artworks with this tag": the primary key can't serve this because `tag_id` is its second column. |

Images are not stored in the database. `npm run media` writes WebP files to `media/` and the row stores their paths and sizes; see [ADR 0007](decisions/0007-content-files-and-media-pipeline.md).

### pricing_rules

| Name | Type | Why |
| --- | --- | --- |
| `pricing_rules_rule_type_check` | CHECK | Only the four component types the engine understands. |
| `fulfillment_type_check` | Domain CHECK | `digital`, `physical`, or `mixed_media`; shared with `commissions`. |
| `pricing_rules_amount_check` | CHECK | Amounts are never negative. |
| `pricing_rules_shape_check` | CHECK | Each rule type has exactly the key fields it needs: `base` needs size + medium, `fulfillment` needs a fulfillment type, and `extra_subject` / `rush` have none. A rule can't be half-specified or ambiguous. |
| `pricing_rules_active_key_idx` | Partial UNIQUE `NULLS NOT DISTINCT WHERE is_active` | At most one **active** price per key, so the engine never sees two competing prices. `NULLS NOT DISTINCT` (Postgres 15+) makes `NULL` key fields count as equal; without it, two active `rush` rules would be allowed, because `NULL ≠ NULL` in SQL. Inactive rows are excluded, so old prices can be kept as history. |

### commissions

| Name | Type | Why |
| --- | --- | --- |
| `commission_status_check` | Domain CHECK | Status is one of the 12 real states. *Which transitions* are allowed is the state machine's job (milestone 4); the database guarantees the value itself is valid. |
| `commissions_subject_count_check` | CHECK | At least one subject. |
| `commissions_size_check`, `commissions_medium_check` | CHECK | Not blank. Size and medium are free text, validated against active pricing rules in the service, so a new size is a pricing change rather than a migration. |
| `commissions_revision_count_check` | CHECK | `0 ≤ revision_count ≤ revision_limit`. The revision limit holds even if application code has a bug. |
| `commissions_amounts_check` | CHECK | Money is all-or-nothing and must add up: either no quote yet (all `NULL`), or non-negative amounts where `deposit + balance = total` exactly. |
| `commissions_quoted_amounts_present_check` | CHECK | Past `inquiry`, a commission must have a price. `canceled` is exempt because a commission can be canceled before it was quoted. |
| `commissions_digital_not_shipped_check` | CHECK | Digital-only work can never be `ready_to_ship` or `shipped`. |
| `commissions_client_created_idx` | Index `(client_id, created_at DESC)` | A client's "my commissions" list, newest first. |
| `commissions_status_created_idx` | Index `(status, created_at DESC)` | The admin list filtered by status, newest first. |

`revision_limit` has no default on purpose. It's a business value that the service sets when a commission is created.

### commission_events

An append-only audit trail with one row per status change.

| Name | Type | Why |
| --- | --- | --- |
| `commission_events_actor_type_check` | CHECK | `client`, `admin`, or `system` (for example, a Stripe webhook). |
| `commission_events_actor_user_check` | CHECK | Client and admin events must name the user; system events must not. Every event is attributable. |
| `commission_events_status_changes_check` | CHECK | `from_status ≠ to_status`. `from_status` is `NULL` only for the creation event. |
| `commission_events_metadata_check` | CHECK | `metadata` is a JSON object, never an array or scalar. |
| `commission_events_append_only` | Trigger | Any `UPDATE` or `DELETE` raises an error. An audit trail that can be edited isn't an audit trail. |
| `commission_events_commission_created_idx` | Index `(commission_id, created_at, id)` | One commission's history in order. `id` breaks ties between events in the same transaction. |

### quotes

| Name | Type | Why |
| --- | --- | --- |
| `quotes_status_check` | CHECK | `draft`, `sent`, `accepted`, `superseded`. |
| `quotes_amounts_check` | CHECK | No negative amounts. |
| `quotes_adjustment_note_check` | CHECK | A manual price change must have a non-blank note explaining it. |
| `quotes_line_items_check` | CHECK | `line_items` is a JSON array: a **snapshot** of the engine's breakdown, kept because pricing rules can change after the quote was sent. |
| `quotes_sent_at_check` | CHECK | A `sent` or `accepted` quote must record when it was sent. |
| `quotes_one_current_per_commission_idx` | Partial UNIQUE `(commission_id) WHERE status <> 'superseded'` | At most one current quote per commission. To revise a quote, the old one is marked `superseded` first, so it's always clear which price applies. |
| `quotes_commission_id_idx` | Index | All quotes for a commission, including superseded ones. |

### payments

Every money movement is one row: `deposit`, `final`, or `refund`. Amounts are always positive, and `type` gives the direction.

| Name | Type | Why |
| --- | --- | --- |
| `payments_type_check`, `payments_status_check` | CHECK | Known values only. `expired` covers Checkout sessions that time out unpaid. |
| `payments_amount_check` | CHECK | `amount_cents > 0`. A zero or negative payment is always a bug. |
| `payments_currency_check` | CHECK | A three-letter lowercase ISO code, as Stripe reports it. |
| `payments_refund_link_check` | CHECK | A refund must reference the payment it refunds, and only refunds may. |
| `payments_stripe_ids_check` | CHECK | Refunds never carry a Checkout session ID; incoming payments never carry a refund ID. |
| `payments_stripe_checkout_session_id_key`, `payments_stripe_refund_id_key` | UNIQUE | The same Stripe object can never be recorded twice. This is a database-level backstop for webhook idempotency. |
| `payments_stripe_payment_intent_id_key` | Partial UNIQUE `WHERE type <> 'refund'` | A payment intent is unique among incoming payments. Refunds reuse the intent of the payment they refund, so they're excluded. |
| `payments_one_succeeded_per_stage_idx` | Partial UNIQUE `(commission_id, type) WHERE type IN ('deposit','final') AND status = 'succeeded'` | A commission can be paid successfully at most once per stage. The last line of defense against double-charging if two sessions or webhooks race. |
| `payments_commission_id_idx` | Index | A commission's payments. |
| `payments_refunded_payment_id_idx` | Partial index | Refunds of a given payment, to total what has already been refunded. |
| `payments_checkout_fields_check` | CHECK | `checkout_url` and `checkout_expires_at` (the open Stripe page, reused by a second "Pay" click) belong to incoming payments only. |
| `payments_refund_fields_check` | CHECK | `reason` and `requested_by_user_id` belong to refunds only. A refund with no requester was automatic or made in the Stripe Dashboard. |
| `payments_reason_check` | CHECK | A refund reason is 1–500 characters once trimmed. |
| `payments_checkout_url_check` | CHECK | Checkout URLs are `https://`, so a stored link can never be a `javascript:` URL. |
| `payments.requested_by_user_id` | FK, `ON DELETE RESTRICT` | Money history keeps who asked for each refund. |
| `payments_shipping_cents_check` | CHECK | `shipping_cents` (milestone 11) is the part of a **final** payment that paid for shipping and packaging: 0 to `amount_cents`, and 0 on deposits and refunds. Reported separately; not counted toward the donation. |

### shipments

Milestone 11 ([ADR 0017](decisions/0017-us-shipping-with-shippo.md)): one row per physical commission, with the address (as the carrier standardized it), the package, the Shippo shipment its current prices belong to, and the option the client chose.

| Name | Type | Why |
| --- | --- | --- |
| `shipments_commission_id_key` | UNIQUE | One shipment per commission (address and package are set with `ON CONFLICT` on it). |
| `shipments.commission_id` | FK, `ON DELETE RESTRICT` | A shipment is part of the commission's money history. |
| `shipments_country_check` | CHECK | `US` only (the terms of service). |
| `shipments_state_check`, `shipments_postal_code_check` | CHECK | A two-letter state code; a 5-digit ZIP or ZIP+4. |
| `shipments_address_text_check` | CHECK | Name and street lines 1–100 characters, city 1–60. |
| `shipments_locality_check` | CHECK | City, state, and ZIP come together. |
| `shipments_address_check` | CHECK | A full address has a name, a first line, and a locality (a second line needs a first). Once `address_removed_at` is set (the client deleted their account), only the city, state, and ZIP remain. |
| `shipments_parcel_check` | CHECK | Weight and the three sides all set (positive) or all empty. |
| `shipments_rate_check` | CHECK | A chosen option is complete (rate, carrier, service, postage, packaging fee, when), and needs the quote it came from, the package, and the address (or its removal). |
| `shipments_rate_amounts_check` | CHECK | Postage, packaging fee, and estimated days are never negative. |
| `shipments_set_updated_at` | Trigger | `updated_at` on every change. |
| `shipments.label_quote_id` | Column | Milestone 11b: the Shippo shipment the latest label prices belong to; a label can only be bought from those. Cleared once bought. |

### shipping_labels

Milestone 11b ([ADR 0018](decisions/0018-shipping-labels-and-tracking.md)): postage labels bought through Shippo, with where the package is. The label PDF isn't stored (Shippo gives a fresh link on request). A voided label stays, with its refund.

| Name | Type | Why |
| --- | --- | --- |
| `shipping_labels.shipment_id` | FK, `ON DELETE RESTRICT` | A label is postage paid for: part of the money history. |
| `shipping_labels_provider_transaction_id_key` | UNIQUE | Each Shippo transaction is recorded once. |
| `shipping_labels_one_active_idx` | Partial UNIQUE index (`shipment_id` where `voided_at IS NULL`) | At most one label in use per shipment; any number voided. |
| `shipping_labels_tracking_number_idx` | Index | Tracking webhooks find the label by its tracking number. |
| `shipping_labels_postage_cents_check` | CHECK | What the postage cost the studio is never negative. |
| `shipping_labels_text_check` | CHECK | Transaction ID, carrier, service, and tracking number non-empty and short; tracking details at most 500 characters. |
| `shipping_labels_tracking_url_check` | CHECK | Tracking links are `https://`. |
| `tracking_status` | Domain (`tracking_status_check`) | `unknown`, `pre_transit`, `transit`, `delivered`, `returned`, `failure`, as Shippo reports them. Shared with `tracking_events`. |
| `shipping_labels_refund_check` | CHECK | A voided label has a refund ID and status (`queued`, `pending`, `success`, `error`); a label in use has neither. |
| `shipping_labels_set_updated_at` | Trigger | `updated_at` on every change. |

### tracking_events

The carrier's scans for a label, from Shippo. Written once, never changed (no `updated_at`). The place is the carrier facility's town, never the delivery address.

| Name | Type | Why |
| --- | --- | --- |
| `tracking_events.label_id` | FK, `ON DELETE RESTRICT` | Scans belong to their label's history. |
| `tracking_events_label_event_key` | UNIQUE | Shippo's ID for each scan, per label: a repeated webhook (Shippo's aren't idempotent) adds nothing. |
| `tracking_events_text_check` | CHECK | Scan ID 1–100 characters; details at most 500, city 100, state 50. |

### products, product_variants, product_photos, inventory_movements

Milestone 12a ([ADR 0019](decisions/0019-shop-catalog.md)): the shop catalog, managed from the admin pages. Prices and stock are per variant (what a customer chooses). The service also keeps two rules the database can't see across rows: a published product has a variant, a photo, and alt text on every photo; a one-of-a-kind product has one variant with a stock of 0 or 1.

| Name | Type | Why |
| --- | --- | --- |
| `product_category` | Domain (`product_category_check`) | `jewelry`, `cards`, `stickers`, `upcycled`: the proposal's four categories. |
| `products_slug_key`, `products_slug_format_check` | UNIQUE, CHECK | One web address per product, lowercase words joined by hyphens. |
| `products_text_check` | CHECK | Name 1–120 characters; slug at most 120; description at most 5,000; materials 1–500 and size 1–200 when set. |
| `products_set_updated_at` (and on variants and photos) | Trigger | `updated_at` on every change. |
| `product_variants.product_id`, `product_photos.product_id` | FK, `ON DELETE CASCADE` | Catalog rows go with their product. From 12b, order lines reference variants with `RESTRICT`, so a product that was ever sold can't be deleted, only hidden. |
| `product_variants_product_name_key` | UNIQUE | Each option name once per product. |
| `product_variants_name_check`, `_price_cents_check`, `_stock_check`, `_position_check` | CHECK | Name 1–80 characters; price above 0 cents; stock and position never negative. |
| `product_variants_product_id_idx`, `product_photos_product_id_idx` | Index | A product's variants and photos are read together. |
| `product_photos_small_key_key`, `product_photos_large_key_key` | UNIQUE | Each stored file belongs to one photo. |
| `product_photos_key_check` | CHECK | Keys are `shop/products/<id>/<16 hex>-small\|large.webp`, the only shape the public photo route serves. |
| `product_photos_size_check`, `_alt_text_check`, `_position_check` | CHECK | A real width and height; alt text 1–300 characters when set (null until the owner writes it); no negative position. |
| `inventory_reason` | Domain (`inventory_reason_check`) | `restock`, `adjustment` (the owner, 12a), and `reservation`, `release`, `sale` (checkout, 12b). |
| `inventory_movements.variant_id` | FK, `ON DELETE CASCADE` | The log goes with a deleted (never-sold) variant. Written only with the stock change itself, never edited. |
| `inventory_movements.actor_user_id` | FK, `ON DELETE RESTRICT` | Who changed the stock (the owner); null for the system. |
| `inventory_movements_change_check`, `_stock_after_check`, `_note_check` | CHECK | A change is never 0; the count after is never negative; a note is 1–300 characters when set. |
| `inventory_movements_variant_id_idx` | Index | A variant's log, newest first. |
| `inventory_reason` (12b) | Domain | `sale` became `return` (items put back after a refund); a paid order changes nothing more, its hold already took the stock. |
| `inventory_movements.order_id` (12b) | FK, `ON DELETE RESTRICT` | The order a `reservation`, `release`, or `return` belongs to. |
| `inventory_movements_order_check` (12b) | CHECK | Holds, releases, and returns name their order; restocks and adjustments don't. |
| `inventory_movements_order_id_idx` (12b) | Index | An order's stock changes. |

### orders, order_items, order_events, order_refunds

Milestone 12b ([ADR 0020](decisions/0020-shop-cart-and-checkout.md)): shop orders, paid in full through Stripe. Money history: nothing here is ever deleted.

| Name | Type | Why |
| --- | --- | --- |
| `order_status` | Domain (`order_status_check`) | `pending_payment`, `paid`, `expired`, `canceled`, `refunded` (see `docs/state-machine.md`). |
| `orders.client_id` | FK, `ON DELETE RESTRICT` | A deleted account is anonymized, never removed, so its orders keep their client. |
| `orders_subtotal_cents_check`, `orders_currency_check` | CHECK | A positive total (from prices at checkout); a lowercase currency code. |
| `orders_stripe_checkout_session_id_key`, `orders_stripe_payment_intent_id_key` | UNIQUE | Each Stripe page and payment belongs to one order (webhooks find orders by them). |
| `orders_checkout_check`, `orders_checkout_url_check` | CHECK | The Stripe page's ID, link (`https://`), and expiry come together. |
| `orders_paid_check` | CHECK | When paid and the payment come together; paid, shipped, delivered, and refunded orders have them. (A late payment on an ended order is recorded and refunded, so it has them too.) |
| `orders_client_id_idx`, `orders_pending_idx` | Index | A client's orders; the sweep's pending orders by page expiry (partial). |
| `order_items.order_id`, `order_items.variant_id` | FK, `ON DELETE RESTRICT` | Lines stay with their order; an ordered option can't be deleted (`order_items_variant_id_fkey`, answered as 409 `PRODUCT_HAS_ORDERS`). |
| `order_items_order_variant_key` | UNIQUE | One line per option per order. |
| `order_items_unit_price_cents_check`, `_quantity_check`, `_text_check` | CHECK | Price above 0; quantity 1–100; the names as they were (1–120 and 1–80 characters). |
| `order_events_actor_check`, `order_events_reason_check` | CHECK | A user for every actor but the system; reasons 1–500 characters. |
| `order_refunds_amount_cents_check`, `_status_check`, `_reason_check` | CHECK | A positive amount; `pending`, `succeeded`, or `failed`; a reason. |
| `order_refunds_stripe_refund_id_key` | UNIQUE | Each Stripe refund recorded once. |
| `order_refunds_restocked_check` | CHECK | Items are put back only when asked, and only after the refund succeeded. |
| `orders_set_updated_at`, `order_refunds_set_updated_at` | Trigger | `updated_at` on every change. |

### Shipping for shop orders (milestone 12c)

[ADR 0021](decisions/0021-shop-shipping.md): shop orders ship through the same shipments, labels, and tracking as commissions, packed in the owner's mailers and boxes.

| Name | Type | Why |
| --- | --- | --- |
| `packing_types` | Table | The owner's mailers and boxes: a name, the inside size (inches), and the empty weight (ounces). Owner-set, so it starts empty. |
| `packing_types_name_key`, `packing_types_name_check` | UNIQUE, CHECK | Each name once, 1–60 characters. |
| `packing_types_size_check`, `packing_types_weight_check` | CHECK | Each side above 0 and at most 108 in (USPS's longest); weight 0–1,120 oz (USPS's 70 lb). |
| `packing_types_set_updated_at` | Trigger | `updated_at` on every change. |
| `products.packing_type_id` | FK, `ON DELETE RESTRICT` | What the product ships in. A packing type in use can't be deleted (409 `PACKING_TYPE_IN_USE`). Indexed (`products_packing_type_id_idx`). |
| `products.pickup_only` | Column | Collected locally, never shipped (large pieces). An order with one is a local pickup. |
| `product_variants_weight_oz_check` | CHECK | An option's packed weight, above 0 and at most 1,120 oz, when set. Publishing a product that ships needs a packing type and a weight on every option. |
| `shipments.order_id` | FK, `ON DELETE RESTRICT` | A shipment now belongs to a commission or a shop order; `commission_id` became nullable. |
| `shipments_order_id_key` | UNIQUE | One shipment per order. |
| `shipments_owner_check` | CHECK | Exactly one of `commission_id` and `order_id`. |
| `orders.shipping_cents`, `orders.pickup` | Columns | What the client paid for postage and packaging at checkout; whether the order is collected locally. The total is the subtotal plus shipping. |
| `orders_shipping_cents_check` | CHECK | Shipping is never negative, and 0 for a pickup. |
| `order_status` (12c) | Domain | Adds `shipped` and `delivered`. |
| `orders_paid_check` (12c) | CHECK | Widened so shipped and delivered orders also keep their payment (migration `orders-paid-shipped`). |

### processed_webhook_events

| Name | Type | Why |
| --- | --- | --- |
| `processed_webhook_events_stripe_event_id_key` | UNIQUE | The webhook handler inserts the event ID first, in the same transaction as its effects. A duplicate delivery fails this constraint and is skipped, so each Stripe event is processed exactly once. |

### files, messages

Only the tables exist so far; the endpoints come in a later phase.

| Name | Type | Why |
| --- | --- | --- |
| `files_kind_check` | CHECK | `reference` (the client's photo), `preview` (watermarked work in progress), or `final` (the deliverable). |
| `files_storage_key_key` | UNIQUE | Each stored object is described by exactly one row. |
| `files_dimensions_check` | CHECK | `width` and `height` both set (positive) or both empty: images have a size, a PDF has none (milestone 10). Written as `(width IS NULL) = (height IS NULL) AND …` so a half-filled pair can't pass as "unknown". |
| `files_original_filename_check` | CHECK | The uploader's file name, 1–200 characters, never containing `/` or `\` (a name, not a path). |

Files are used from milestone 10 ([ADR 0016](decisions/0016-commission-files-on-r2.md)): the bytes live in a private R2 bucket under `storage_key` (`commissions/<id>/<kind>/<uuid>.<ext>`); rows are deleted, with their objects, when the keeping period ends (90 days after a commission ends for reference photos; a year after full payment for previews and final files).
| `files_size_check` | CHECK | `size_bytes > 0`. |
| `files_content_type_check` | CHECK | A MIME type shape such as `image/jpeg`. |
| `files_commission_kind_idx` | Index `(commission_id, kind)` | "Previews for this commission". |
| `messages_body_check` | CHECK | No blank messages. |
| `messages_commission_created_idx` | Index `(commission_id, created_at, id)` | A commission's thread, in order. |

### charities, donations

| Name | Type | Why |
| --- | --- | --- |
| `charities_name_key` | UNIQUE | No duplicate charities. |
| `charities_name_check` | CHECK | The name is 1–200 characters once spaces are trimmed (never blank). |
| `charities_website_url_check` | CHECK | Must be an http(s) URL. |
| `charities_one_active_idx` | Partial UNIQUE on `(true) WHERE is_active` | At most one active charity, so "the currently active charity" is never ambiguous. Every active row has the same index key (`true`), so a second active row is a duplicate. |
| `donations_status_check` | CHECK | `pending`, `owed`, `paid`, or `reversed`. |
| `donations_percentage_check` | CHECK | `0 < percentage ≤ 100`. It's stored per row so past donations keep the rate they were made at. |
| `donations_amounts_check` | CHECK | Amounts are non-negative, and the donation never exceeds its base. |
| `donations_paid_has_payout_date_check` | CHECK | A `paid` donation must have a payout date. |
| `donations_payment_id_key` | UNIQUE | One donation per payment, so a replayed webhook can never create a second donation. |
| `donations_charity_id_idx`, `donations_status_idx`, `donations_created_at_idx` | Index | The admin filters: by charity, by status, and by month (a `created_at` range). |
| `donations_commission_id_idx` | Index | Donations for one commission. |
| `donations_tree_count_check` | CHECK | Tree donations (milestone 8) fund at least one tree. |
| `donations_tree_amount_check` | CHECK | A tree donation costs exactly $1 a tree: `donation_amount_cents = tree_count × 100`. |
| `donations_requested_fields_check` | CHECK | An `owed` or `paid` tree donation has the time it was requested. Digital Humani's request ID is recorded when known; it's null when a retry found the trees already counted under the commission's reference (the API counts a reference's trees but can't list its requests; relaxed in milestone 8c). |
| `donations_tree_request_id_key` | UNIQUE | One Digital Humani request is never recorded twice. |
| `donations_pending_trees_idx` | Partial index `(id) WHERE status = 'pending' AND tree_count IS NOT NULL` | The retry finds tree requests that haven't gone through. |

**Tree donations** ([ADR 0013](decisions/0013-giving-through-digital-humani.md)): the final payment records one, `pending`. `request_attempted_at` is stamped and committed before calling Digital Humani, so a lost answer is detected: the retry asks Digital Humani how many trees it already has under the commission's reference and plants only what's missing, never twice. Once accepted, the row is `owed` (the planting partner will invoice the owner) with `requested_at`, and `tree_request_id` when a new request was made. The refund flow never refunds a commission's tree money.

### sessions

Server-side login sessions (milestone 3, [ADR 0004](decisions/0004-server-sessions-in-postgres.md)). The browser holds only the signed `sid` in an `httpOnly` cookie.

| Name | Type | Why |
| --- | --- | --- |
| `sessions_pkey` | PRIMARY KEY `(sid)` | Every request looks up its session by ID. |
| `sessions_expire_idx` | Index | The store's periodic cleanup deletes `WHERE expire < now()`. |

## Deliberately deferred

- **Donation adjustment history** for partial refunds is designed in milestone 8, where the audit rules are decided.
- **Trees for shop orders** come in milestone 12c; `donations` is tied to commission payments until then.

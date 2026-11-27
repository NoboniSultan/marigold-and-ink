# 19. Shop catalog

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

Phase 6 of the proposal adds a shop of ready-made pieces in four categories (beaded jewelry, greeting cards, stickers, upcycled thrifted pieces), separate from commissions. Each product has variants (a pack size, a colour), photos, and stock. One-of-a-kind pieces must never sell twice, sold pieces stay visible marked as sold, and every stock change is logged.

The work is split into **12a** (the catalog: products, variants, photos, stock, the admin pages and the public pages), **12b** (cart and checkout with stock reserved during checkout) and **12c** (shop shipping and trees).

The gallery's artworks live in a content file with images committed to the repository (ADR 0007). That ADR expected a move to the database once an admin UI existed.

The owner decided (2026-11-27):
- Products and photos live in the **database**, managed from admin pages. Photos are uploaded there.
- Each **variant has its own price**. A product with no choices has one variant.
- Until checkout exists, the shop is **visible only to the admin**.
- The **four categories** from the proposal are built in.
- A sold one-of-a-kind piece **stays visible as "Sold"** until the owner hides it.

## Decision

- **Tables:**
  - `products`: slug, name, a `product_category` domain, description, materials, size, `one_of_a_kind`, `published`.
  - `product_variants`: name, `price_cents`, `stock`, position.
  - `product_photos`.
  - `inventory_movements`: change, stock after, reason, note, who.
  - Variants and photos are deleted with their product. Orders in 12b will reference variants with `RESTRICT`, so a product that was ever sold can only be hidden.
- **Stock changes** go through one repository function, which updates the count and writes the movement in the caller's transaction. In 12a the owner sets a new count with a reason (restock or adjustment). 12b adds reservation, release and sale.
- **Rules (pure, in `shop.rules.ts`):**
  - A product can be published only with a variant, a photo, and alt text on every photo.
  - A published product must stay that way: removing its last variant or photo, or clearing alt text, is refused until it's hidden.
  - A one-of-a-kind product has a single variant with a stock of 0 or 1.
  - These are checked after each change, under a lock on the product row, so any change that breaks them rolls back.
- **Photos:**
  - Processed with sharp into two WebP sizes (600 px wide, and at most 1600 px), turned upright, converted to sRGB, with **no metadata** (no location).
  - Stored in the private R2 bucket under `shop/products/<id>/<hash>-small|large.webp`.
  - The site serves them at `/media/shop/products/...` with `Cache-Control: immutable`: the name holds a hash of the image, so a changed photo always gets a new address. Only keys of that exact shape can be read, never commission files.
  - At most 10 photos per product, and an upload is up to 20 MB (JPEG, PNG or WebP).
- **The public shop:** `GET /api/v1/shop/products` (a category filter, pages) and `/shop/products/:slug`. They return prices and whether each variant is available, never the stock count.
- **Closed until opened:** `SHOP_OPEN` (default false).
  - While closed, the shop answers only the admin, through `optionalAuth`, a middleware that loads the user if there is one. Others get 404 `SHOP_CLOSED`.
  - The admin also sees unpublished products there, as a preview.
  - The header shows "Shop" to everyone once it's open, and to the admin before then.
- **Admin API under `/api/v1/admin/shop`:** products, variants, stock with its log, photos (upload, alt text, order, delete). Every change answers with the whole product as it now is.

## Consequences

- The owner adds and edits products without a deploy. The artworks still come from the content file; moving them to the database too is a separate decision.
- Photos cost a request to R2 on the first view of each size, then browsers cache them. If traffic grows, a public bucket or CDN in front of `/media/shop` can replace this without changing the addresses.
- Prices are typed by the admin, not computed. The pricing engine stays for commissions only.
- 12a has no cart. Stock is only changed by the owner until 12b reserves it at checkout.
- The donation for shop orders and shop shipping (several items in one box, flat mailers, local pickup for furniture) are decided in 12c.

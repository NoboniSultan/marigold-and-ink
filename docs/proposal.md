# Marigold & Ink: Project Proposal

A full-stack platform for custom portraits and handmade goods, with commissions, a shop, shipping, and charitable giving.

## 1. Executive Summary

Marigold & Ink is a web platform where I showcase and sell my handmade work: custom portraits, handmade clay jewelry, greeting cards (made by using dried flowers & recycled paper & recycled teabags), stickers, and thrifted pieces such as vases and small furniture that I repaint and give a second life, Tibetan prayer flags, custom hoodies & shirts, acrylic paintings, clay sculptures, ink drawings, sewn portraits on fabric. My work includes sketches made on physical paper and mixed-media pieces that combine a physical sketch with digital work. The platform handles custom commissions from request to delivery (quote, payment, revisions, and fulfillment) and a ready-made shop with inventory tracking and checkout. It also automatically donates 25% of every order to charity (most likely an organization that plants trees).

The project is intentionally backend-heavy. The frontend is a clean gallery showing examples of my work where people can add & upload reference photos for me to make custom pieces, a shop, a request form, and a client dashboard, an about page which has my photo and bio/background. The engineering effort goes into the commission workflow, the product catalog and inventory, secure payments (most likely through Stripe), file handling, shipping, and a transparent donation ledger.

## 2. Problem and Opportunity

Independent artists usually run commissions through direct messages, spreadsheets, and manual payment links. This causes lost requests, unclear pricing, scope creep during revisions, missed payments, and no organized way to ship physical work or track charitable giving. Selling one-of-a-kind handmade pieces adds one more problem: each piece exists only once, so it must never be sold twice.

Marigold & Ink replaces this with one system where every commission has a clear status, a fixed price, a limited number of revisions, and a tracked shipment where applicable. Every shop item is tracked in live inventory, and every order of any kind has a recorded donation.

## 3. Goals

- Showcase my portfolio in a distinctive, personal gallery that does not look like a template.
- Let clients request custom portraits and receive a clear, automatically calculated quote.
- Sell ready-made handmade goods (clay jewelry, greeting cards, stickers, and repainted thrifted pieces) through a shop with accurate, real-time inventory.
- Collect payments securely in two stages for commissions: a deposit and a final balance.
- Support three fulfillment types: digital delivery, physical shipping, and hybrid (mixed media).
- Give clients real-time tracking for shipped orders.
- Donate 25% of every order to a chosen charity, with a transparent record.
- Build a production-quality backend with tests, documentation, and deployment that demonstrates professional engineering practice.

## 4. Product Offerings

| Category | Offering | Description | Sale type | Delivery |
| --- | --- | --- | --- | --- |
| Commission | Physical sketch portrait | Original portrait drawn on paper | Made to order | Shipped to client |
| Commission | Digital portrait | Fully digital artwork | Made to order | High-resolution file via secure link |
| Commission | Mixed-media portrait | Physical sketch combined with digital work | Made to order | Shipped original plus digital file |
| Shop | Handmade beaded jewelry | Necklaces, bracelets, earrings, and other beaded pieces | Ready-made, small batches or one-of-a-kind | Shipped |
| Shop | Greeting cards | Individual cards and card sets | Ready-made, restockable | Shipped |
| Shop | Stickers | Individual stickers and sticker packs | Ready-made, restockable | Shipped |
| Shop | Upcycled thrifted pieces | Thrifted vases and small furniture that I repaint and restore | One-of-a-kind | Shipped, or local pickup for large furniture |

Commission pricing is based on size, number of subjects, medium, and optional rush service. Shop items have a fixed price set per product.

## 5. Core User Flow

1. The client browses the gallery and submits a commission request with size, medium, number of subjects, notes, and reference photos.
2. The system generates a quote from the pricing rules. I can review or adjust it before sending.
3. The client accepts the quote and pays a deposit through Stripe.
4. I work on the piece and upload watermarked previews. The client can request revisions within a set limit.
5. The client approves the final design and pays the remaining balance (plus shipping for physical or mixed-media pieces).
6. Digital pieces are delivered through an expiring secure link. Physical and mixed-media pieces are packaged, labeled, and shipped with tracking.
7. The client receives a confirmation that includes the donation made on their order.

**Shop orders.** Ready-made items follow a shorter path. The client adds items to a cart, the system reserves the stock, the client pays in full through Stripe Checkout, and the order moves through packing, shipping with tracking, and delivery. The donation is recorded when payment succeeds, exactly as it is for commissions.

## 6. Key Features

### 6.1 Authentication and Roles

Client and admin accounts with secure password hashing and session or token-based authentication. Authorization rules ensure clients can only access their own commissions, files, and messages.

### 6.2 Commission State Machine

Every commission moves through defined statuses: inquiry, quoted, deposit paid, in progress, revision, awaiting final payment, ready to ship, shipped, delivered, completed (plus canceled and refunded). The API rejects invalid transitions, for example shipping before the balance is paid. Each change is written to an event history table for a full audit trail.

### 6.3 Pricing Engine

Quotes are computed on the server from configurable rules: base price by size and medium, additional subjects, rush fee, and fulfillment type. Prices are never trusted from the client.

### 6.4 Payments

Stripe Checkout handles the deposit and final payment. Webhook handlers verify signatures and are idempotent so a retried event is never processed twice. Refunds and partial refunds are supported and tied back to the donation ledger.

### 6.5 File Handling

Reference photos and work-in-progress previews are stored in cloud object storage. Previews are watermarked server-side until payment is complete. Final files are served only through expiring signed URLs.

### 6.6 Slots and Waitlist

I set a maximum number of active commissions per period. When slots are full, new requests join a waitlist that is promoted automatically when a slot opens.

### 6.7 Messaging and Notifications

Each commission has a message thread between me and the client. Background jobs send email notifications for new messages, payment reminders, status changes, and shipping updates.

### 6.8 Admin Dashboard API

Endpoints for managing commissions, quotes, pricing rules, slots, products, inventory, orders, shipments, and donations, plus analytics such as revenue by month, average turnaround time, and most popular styles and best-selling products.

### 6.9 Public Gallery API

Paginated artwork and product listings with category and tag filtering and search.

### 6.10 Shop Catalog, Cart, and Inventory

Ready-made items are sold through a catalog that is separate from commissions. Each product belongs to a category (beaded jewelry, greeting cards, stickers, or upcycled home goods) and can have variants such as size, color, or pack quantity. Photos, descriptions, materials, and dimensions are stored with the product.

Inventory is tracked per variant. One-of-a-kind pieces, such as a repainted vase or a piece of furniture, are stored with a quantity of one. When a client starts checkout, the system reserves the stock inside a database transaction with row-level locking, so two buyers can never purchase the same piece. Unpaid reservations expire after a short timeout and the item returns to the shop.

Every stock change is written to an inventory movement log (restock, reservation, release, sale, adjustment) so counts can always be audited. The admin dashboard shows low-stock alerts for small-batch items, and sold one-of-a-kind pieces stay visible in the gallery marked as sold. Shop orders are paid in full at checkout through Stripe, then flow through the same shipping and donation systems as commissions.

## 7. Shipping System

Physical and mixed-media commissions, and all shop orders of physical goods, require a shipping workflow built into the platform.

### Capabilities

- Collect and validate the client's shipping address at checkout for physical and hybrid orders.
- Calculate live shipping rates based on package weight, dimensions, and destination through a shipping API such as EasyPost or Shippo.
- Offer carrier and speed options, plus optional shipping insurance for original artwork.
- Generate shipping labels from the admin dashboard.
- Receive carrier tracking webhooks and update shipment status automatically (label created, in transit, out for delivery, delivered, exception).
- Email the client tracking information and delivery confirmation.
- Move the commission to delivered when the carrier confirms delivery.

### Data model additions

- **shipments:** commission reference, carrier, service level, tracking number, label URL, cost, insured value, status, shipped and delivered timestamps.
- **shipment_events:** tracking history from carrier webhooks.
- **addresses:** client shipping addresses.

### Business rules

- Digital-only orders skip the shipping step entirely.
- Mixed-media orders require both a shipment and a digital file delivery before the commission can be completed.
- Shipping cost is shown to the client before the final payment (or at checkout for shop orders) and is not counted toward the donation base.
- Shop orders with several items are packed together where possible, and package weight and dimensions are computed from the products in the cart.
- Small flat items such as cards and stickers use lower-cost flat-mailer rates. Fragile items such as vases require protective packaging and insurance.
- Large furniture pieces are offered as local pickup or by custom shipping quote rather than standard carrier rates.
- Initial scope covers domestic shipping, with international shipping as a later enhancement.

## 8. Charitable Giving: 25% of Every Order

A core value of the project is that 25% of each order is donated to charity.

### How it works

- When a payment succeeds, the system calculates the donation and records it in a donations ledger tied to the order.
- Donations are calculated on the item price (the artwork or product), before shipping and tax. This definition is an assumption to confirm before launch.
- If an order is refunded, the corresponding donation record is adjusted or reversed.
- I choose the recipient charity in the admin dashboard, and the charity can change over time. Each donation records which charity it was assigned to.
- A monthly summary report shows total sales, donation amount owed, and donations marked as paid out, with a field for the receipt or confirmation reference.
- A public transparency page shows the running total donated and the charities supported.
- Order confirmation emails show the donation amount generated by that order.

### Data model additions

- **charities:** name, description, website, active status.
- **donations:** order reference, charity reference, percentage, base amount, donation amount, status (pending, owed, paid, reversed), payout date, receipt reference.

### Considerations

Before launch I will confirm how the donations should be handled legally and for tax purposes (for example, how the donated amount is treated in my income reporting) with a qualified professional. Because the donation is a percentage of the price rather than of profit, I will also review pricing for low-margin items such as stickers and repainted furniture so each product still covers its materials and my time. The platform tracks the numbers, but it does not replace that advice.

## 9. Technical Architecture

| Layer | Technology |
| --- | --- |
| Backend | Node.js and Express |
| Database | PostgreSQL |
| Job queue and caching | Redis with BullMQ |
| Payments | Stripe (Checkout and webhooks) |
| File storage | S3 or Cloudinary |
| Image processing | Sharp (watermarking and resizing) |
| Shipping | EasyPost or Shippo |
| Email | Resend or Nodemailer |
| Frontend | A lightweight custom-designed client (React or server-rendered) |
| Testing | Jest and Supertest |
| DevOps | Docker, GitHub Actions CI, cloud deployment |

## 10. Core Data Model

users, artworks, tags, artwork_tags, commissions, commission_events, quotes, pricing_rules, payments, files, messages, slots, addresses, shipments, shipment_events, charities, donations, products, product_variants, inventory_movements, carts, cart_items, orders, order_items.

## 11. Security and Reliability

- Input validation on every endpoint and parameterized queries throughout.
- Rate limiting on authentication and submission routes.
- Stripe and shipping webhook signature verification.
- Idempotency keys for payment and donation creation.
- Private file access only through signed URLs.
- Database transactions around any step that changes money, status, inventory, or donation records together.
- Centralized error handling and structured logging.
- Automated tests for the state machine, pricing engine, payment webhooks, inventory reservation, and donation calculations.

## 12. Development Phases

- **Phase 1: Foundation.** Authentication, roles, database schema, gallery CRUD, commission requests, and the state machine with manual quotes.
- **Phase 2: Money.** Pricing engine, Stripe deposit and final payment, webhook handling, and refunds.
- **Phase 3: Files.** Reference uploads, watermarked previews, and signed-URL delivery of final files.
- **Phase 4: Fulfillment.** Address collection, shipping rate calculation, label generation, tracking webhooks, and delivery confirmation.
- **Phase 5: Giving.** Charity management, donation ledger, refund adjustments, monthly reporting, and the public transparency page.
- **Phase 6: Shop.** Product catalog and categories, variants, cart, inventory tracking with atomic stock reservation for one-of-a-kind pieces, shop checkout, multi-item shipping rates, and donation records for shop orders. This phase reuses the payment, shipping, and donation systems built earlier.
- **Phase 7: Polish and Launch.** Job queue, email notifications, slots and waitlist, analytics, frontend design polish, documentation, CI, and deployment.

## 13. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Scope is too large | Build in phases; Phases 1 to 3 form a usable MVP |
| Payment or webhook bugs | Idempotency, signature verification, test mode, and automated tests |
| Shipping damage or loss of original art | Insurance option, tracked shipping, and packaging standards |
| Donation miscalculation | Single calculation function, database transactions, and unit tests |
| Third-party API changes or limits | Wrap external services in adapter modules so providers can be swapped |
| Selling a one-of-a-kind piece twice | Atomic stock reservation with row-level locking and expiring carts |
| Fragile or bulky items (vases, furniture) | Protective packaging standards, insurance, and local pickup or custom quotes for large pieces |

## 14. Success Criteria

- A client can complete a full commission, from request to delivery, without manual intervention beyond my creative work.
- All three fulfillment types work end to end.
- Shop orders for jewelry, cards, stickers, and upcycled pieces work end to end, and a one-of-a-kind item can never be sold twice.
- Every paid order produces a correct donation record, including after refunds.
- Payment and webhook logic is covered by automated tests.
- The platform is deployed, documented, and ready to present in a portfolio and in interviews.

## 15. Future Enhancements

- International shipping and customs forms.
- Gift cards and print sales of finished artwork.
- Client accounts with saved addresses and commission history.
- Admin-configurable donation percentage per product.
- Automated charity payouts or integration with a donation platform.
- Image-based reference analysis to help estimate complexity for quotes.

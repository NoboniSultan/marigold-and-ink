# 21. Shipping for shop orders

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

Milestone 12b let customers buy from the shop (ADR 0020), but orders had no way to reach them. Commissions already ship through Shippo: a checked US address, live USPS prices, labels, and tracking (ADRs 0017 and 0018). Shop orders differ:
- an order holds several items;
- cards and stickers go in flat mailers, jewelry in small boxes;
- large upcycled furniture can't be mailed at all.

The owner decided (2026-11-27):
- **Live USPS prices** for the packed order, chosen by the customer in the cart, like commissions.
- **Packing types** (the owner's mailers and boxes) are managed in the admin, and each option has a packed weight. The real sizes and weights are the owner's values: the table starts empty and nothing is seeded.
- The same **`PACKAGING_FEE_CENTS`**, once per order.
- **Pickup-only** products make the whole order a local pickup.
- The cart **fills in the address** from the client's last shipped order.

## Decision

- **Packing** (`packOrder` in `orders.rules.ts`, pure, 100% coverage):
  - Any pickup-only item makes the order a pickup.
  - Otherwise the order goes in the largest packing type among its items (by volume). Its weight is each item's packed weight times its quantity, plus the empty packing, summed in exact hundredths of an ounce.
  - Anything over USPS's 70 lb (1,120 oz), or an item missing its packing type or weight, can't be shipped. The cart says so and checkout refuses it.
- **Publishing:** a product that ships needs a packing type and a weight on every option before it's published (`PRODUCT_INCOMPLETE` lists `shipping`). The check applies when a product is being published, so editing an already-published product is never blocked by it.
- **In the cart** (`POST /cart/shipping-options`): Shippo checks the address and prices the packed parcel. Each option shows postage plus the packaging fee. The address comes back as the carrier standardized it.
- **At checkout:**
  - Shipping is priced again from Shippo and never taken from the request. The client sends the service it chose and the total it saw.
  - If that service is gone, the answer is 409 `SHIPPING_OPTION_STALE`; if its price changed, 409 `SHIPPING_PRICE_CHANGED`. Both carry the current options, and the cart asks the client to choose again.
  - The order records `shipping_cents`, and Stripe's page shows a "Shipping & packaging" line.
  - The shipment (address, parcel, the chosen rate) is saved in the same transaction as the order.
- **One shipping system for both:**
  - `shipments` belong to a commission or an order (`shipments_owner_check`).
  - The label and tracking code works through a small owner interface (`shipping.owners.ts`): load or lock the owner, say where it stands, move it to shipped or delivered, and email the client.
  - Orders register their handler when their module loads, so the shipping module never imports the orders module.
  - Labels, voiding, the webhook, the daily check, and the delivery-problem alert all work the same for orders.
- **Order lifecycle:**
  - `paid → shipped → delivered`, moved by tracking (the first scan, then delivery) or by the admin ("Mark shipped", "Mark delivered").
  - A pickup goes `paid → delivered` when the admin marks it "Picked up".
  - Shipped and delivered orders can still be refunded in full, shipping included.
- **Reporting:** the monthly report's shop sales include shipping, and its shipping column adds shop shipping to commission shipping.

## Consequences

- The owner must enter packing types and weights before any shippable product can be published.
- Packing everything in the largest packing type can overcharge an order that would fit a smaller one, and can't split a heavy order across boxes. That's acceptable for small shop items; splitting is in the backlog.
- An order with one pickup-only piece is collected in full, even its small items.
- Prices can change between the cart and checkout. The client is asked to choose again rather than being charged a price they didn't see.
- Trees for shop orders, and opening the shop, come in 12d.

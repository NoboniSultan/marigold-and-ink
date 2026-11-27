# 20. Shop cart and checkout

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

Milestone 12a built the shop catalog (ADR 0019). 12b lets a customer buy from it. The proposal (6.10) asks that stock is held when checkout starts, inside a transaction with row locks, so two buyers can never get the same one-of-a-kind piece. Unpaid holds should expire, every stock change should be logged, and shop orders should be paid in full through Stripe.

The owner decided (2026-11-27):
- Buying needs an **account**, like commissions.
- Items are held for **30 minutes** (Stripe's shortest payment page).
- **Full refunds** only, with the admin choosing whether the items go back on sale.
- An **order confirmation email** (the owner's wording).
- Shop sales go in the **same monthly report**, in their own columns.

## Decision

- **The cart lives in the browser** (`localStorage`). It holds only option IDs and quantities; prices are never stored there. The cart page asks the server to price it (`POST /cart/preview`), and checkout takes prices and stock from the shop under lock. A missing or blocked storage just makes the cart last for the visit.
- **Checkout** (`POST /orders`) is one transaction:
  1. The client's earlier unpaid order is closed. Stripe is asked about its page first: if it was paid, it's recorded as paid; otherwise the page is expired and the stock released.
  2. A new order row is created.
  3. Each option's stock row is locked, in ID order so two checkouts can't deadlock. The shop checks each is for sale with enough stock (else 409 `OUT_OF_STOCK`, saying what's left) and takes the quantities off with `reservation` log rows.
  4. The lines are saved with the names and prices as they were.
  5. A Stripe Checkout page is opened for 30 minutes (idempotency key `order-checkout-<id>`).

  If Stripe fails, everything rolls back and nothing stays held.
- **Paid or not:**
  - Stripe's webhook marks the order paid, and the confirmation email goes out only after the transaction commits. Or the webhook ends it (`expired`) and the stock goes back with `release` rows.
  - A payment that arrives for an order that already ended is refunded automatically (key `order-auto-refund-<session>`).
  - A **sweep** (at startup and every 5 minutes) asks Stripe about pending orders whose page closed more than 5 minutes ago, in case a webhook was missed. A page that completed but isn't paid yet (a delayed method) is left holding its stock.
- **Orders** have their own state machine (`orders.stateMachine.ts`, 100% coverage) and history (`order_events`), like commissions: `pending_payment → paid | expired | canceled`, then `paid → refunded`.
- **Refunds:** the admin refunds a paid order in full (`order_refunds`). With "put back on sale", the items return with `return` log rows once the refund succeeds. Refunds made in the Stripe Dashboard are recorded from the webhook, and the order becomes refunded once they cover it.
- **Tables:**
  - orders get their own tables (`orders`, `order_items`, `order_events`, `order_refunds`) rather than sharing commission `payments`, whose code (100% covered) stays untouched;
  - the Stripe webhook tries order events first, then the commission handlers;
  - `inventory_movements.order_id` ties holds, releases and returns to their order.
- **A product that was ever ordered can't be deleted** (order lines reference options with `RESTRICT`). The admin gets 409 `PRODUCT_HAS_ORDERS` and hides it instead.
- **Accounts:** deleting an account ends its unpaid orders (stock released, Stripe pages closed after commit). Paid orders stay, under "Deleted user". The data download includes orders.
- **Report:** commission sales, shop sales and shop refunds are separate columns; net sales covers both.

## Consequences

- An abandoned checkout keeps its items off sale for up to 30 minutes (plus up to 5 minutes if the webhook is missed). That's the price of never selling a piece twice.
- The cart can't be shared between devices until accounts store one (backlog).
- Prices can change between the cart page and checkout. The order always takes the price at checkout, and the cart page shows the current one.
- Stripe's page offers Link's bank and Klarna options alongside cards, even though the session is card-only, which is what Stripe recorded for every session. A delayed payment would complete as "unpaid". The webhook then ignores it and the sweep leaves it holding stock, but nothing marks it paid when the money arrives (the backlog lists handling `async_payment_succeeded`). The simplest fix is turning off Link's bank and Klarna options in the Stripe Dashboard.
- Shipping for shop orders, trees for shop orders, and opening the shop come in 12c.

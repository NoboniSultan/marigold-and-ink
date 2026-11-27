# 22. Trees for shop orders

- **Status:** Accepted
- **Date:** 2026-11-27

## Context

The proposal promises 25% of every order to planting trees, and commissions have done so since milestone 8 (ADR 0013): trees are requested through Digital Humani once a commission is fully paid, and their money is never refunded. Shop orders (ADRs 0019 to 0021) had no trees yet.

Digital Humani can't cancel a request. So when trees are ordered decides what a refund can give back. The proposal says the donation is "recorded when payment succeeds". Shop orders, though, are often refunded before they arrive (lost or damaged in the mail), so trees ordered at payment would often outlive their order.

The owner decided (2026-11-27):
- Trees for a shop order are recorded **when it's delivered**.
- A refund after delivery gives back **everything except the tree money**, as for commissions.
- Opening the shop stays the owner's step, guided by a checklist. The server refuses to open it without payments and shipping.
- For now only the admin sees an order's trees; telling customers waits for the owner's wording.

## Decision

- **When:** an order's trees are recorded in the transaction that moves it to `delivered`. It moves there by:
  - tracking (Shippo's webhook, the daily check, or "Check tracking now");
  - the admin's "Mark delivered";
  - "Mark picked up" for a pickup.

  This happens in `moveOrder`, so no way of delivering an order can skip it. The trees are requested from Digital Humani after the commit, with the same claim-and-retry logic as commissions.
- **How much:** `DONATION_PERCENT` of the order's **items** (its subtotal), never shipping, rounded up to whole $1 trees (`treesFor`, the commission rule).
- **Data:**
  - `donations.order_id`: a donation comes from a commission payment or a shop order (`donations_source_check`), with at most one per order (`donations_order_id_key`).
  - Order donations always fund trees.
  - Digital Humani's reference is `order-<id>`; commissions keep `commission-<id>`.
- **Refunds:**
  - Before delivery an order is refunded in full.
  - After delivery the refund is the total minus the tree money (`refundableCents`, from the same pure `refundableCents` function as commissions).
  - An order counts as refunded once refunds cover that amount, including one made in the Stripe Dashboard.
  - If the trees took the whole order (a $1 item funds one $1 tree), it can't be refunded.
- **Showing it:**
  - the admin order page shows the order's trees and what a refund gives back;
  - the admin Giving page lists order donations, linked to their order, and marks them paid with the commissions';
  - the public tree total and the monthly report include them.
- **Opening the shop:** `SHOP_OPEN=true` is refused unless payments and shipping are configured. `docs/shop-opening-checklist.md` lists the owner's steps before turning it on.

## Consequences

- Trees come later than the proposal said: at delivery, not at payment. An order refunded before it arrives never orders trees, and the owner never pays for trees on money they gave back.
- An order that never gets marked delivered (no tracking, never marked by hand) never funds trees. The admin's "Mark delivered" covers this.
- Cheap orders give more than 25% because of rounding up (a $5 order funds 2 trees, 40%), like small commissions. The proposal's pricing review for low-margin items should account for it.
- The site's wording, terms, and privacy policy still say only commissions plant trees. Updating them is on the opening checklist (the owner's words).

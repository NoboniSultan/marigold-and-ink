# 13. Giving through Digital Humani

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

The shop's promise is that 25% of every commission goes to planting trees. The owner wanted it fully automated, and has no time to work with a charity directly. One Tree Planted, the owner's first choice, has no public API for per-order donations.

[Digital Humani](https://digitalhumani.com) is a nonprofit, registered in Quebec, that offers "Reforestation as a Service": `POST /tree` asks a planting partner (One Tree Planted among them) to plant a number of trees. Each tree costs $1, and the partner invoices the business directly, monthly or quarterly. The API is free and has a sandbox, but it has **no cancel endpoint and no idempotency key**.

The owner's decisions for milestone 8:
- request trees **when a commission is fully paid** (after the final payment), not per payment;
- **round up** to whole trees, so the share given is never below 25%;
- plant with a One Tree Planted project through Digital Humani;
- **never refund the tree money**: once requested, trees can't be cancelled, and the owner can't pay for them out of pocket;
- the Giving page's tree morph plays on scroll up to the stage reached: sprout at 50 trees, full tree at 200.

## Decision

- **Recording:** in the Stripe webhook's transaction, the final payment inserts a `donations` row: `pending`, `tree_count = ceil(25% of the full price / $1)`, with `donation_amount_cents = tree_count × 100`, against the active charity. Nothing external happens inside the transaction, so a Digital Humani outage can never fail a payment. One row per payment (`donations_payment_id_key`) makes replays harmless.
- **Requesting:** after the webhook commits, and when the server starts, `requestPendingTrees` sends each pending row. To avoid ordering trees twice without an idempotency key:
  1. a short transaction claims the row (`FOR UPDATE SKIP LOCKED`), stamps `request_attempted_at`, and commits **before** the call;
  2. a row attempted in the last 5 minutes is skipped (it may still be in flight);
  3. a row attempted before asks Digital Humani for requests under its reference (`commission-<id>`, our only identifier there) and adopts a matching one instead of planting again;
  4. success records Digital Humani's request ID and moves the row to `owed`.
- **Refund cap:** the admin refund flow caps a commission's refunds at paid − already refunded − tree money (`withheldForTreesCents`: non-reversed tree rows). A refund before the final payment is unaffected.
- **Configuration:** `DIGITALHUMANI_*` and `DONATION_PERCENT` (no code default) switch giving on together, and need payments on. `DIGITALHUMANI_ENVIRONMENT=production` is refused while Stripe is test-only.
- **Public total:** `GET /api/v1/giving` returns the trees funded (non-reversed tree rows). The page's morph uses flubber and Motion's `useTransform`, and is loaded only on `/giving`.

## Consequences

- **The tree money is real money the owner owes** once a request is made. The invoice comes from the planting partner; the site records `owed`, and marking a donation `paid` (with the receipt) is still to be built (backlog).
- **Refunds made in the Stripe Dashboard bypass the cap.** The webhook records them as usual, but can't stop them. The setup guide says to refund only through the site.
- **Retries happen at the next payment or restart**, not on a timer; there's no job queue yet. With Render's free plan restarting regularly, pending rows don't wait long. A scheduled retry belongs with the background jobs (backlog).
- **A commission that is refunded in full before the final payment never orders trees**, which is the point of requesting at full payment. The cost is that trees come later: at delivery, not at the deposit.
- **Rounding up gives slightly more than 25%** (a $110 commission funds 28 trees, $28, rather than $27.50).

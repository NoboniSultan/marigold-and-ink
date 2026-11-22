# 11. Stripe Checkout payments, webhooks, and refunds

- **Status:** Accepted
- **Date:** 2026-11-22

## Context

Commissions are paid in two stages: a deposit once the quote is sent, and the balance once the client approves the final design. The owner's requirements:
- Stripe, **test mode only**, through an adapter that is the only code importing the SDK;
- amounts from the stored quote, never from the request; idempotency keys on every create call;
- a webhook that checks signatures, records each event ID first, and handles a duplicate as a no-op, with the payment, the status change, and the audit event in one transaction;
- full and partial refunds by the admin.

The `payments` and `processed_webhook_events` tables already existed (milestone 2), with database-level guards: unique Stripe IDs, and at most one successful deposit and one final payment per commission.

Decisions the owner made for this milestone:
- **Currency:** USD.
- **A payment that arrives too late** (the commission was cancelled while the Stripe page was open) is **refunded automatically**.
- **A refund changes the status only when everything paid has been refunded**, and only from `deposit_paid`, `in_progress`, or `awaiting_final_payment`. Partial refunds, and refunds after the final payment, move money without changing the status.
- **A minimal commission page** with the "Pay" button, rather than API-only.

## Decision

**Stripe Checkout, not a card form of our own.** The client pays on Stripe's hosted page, so card data never reaches this app, and Stripe handles 3-D Secure, receipts, and declines. Only cards are offered (`allowed_payment_method_types: ['card']`): they settle at once, so `checkout.session.completed` means paid. Delayed methods such as bank debits would need the `async_payment_*` events and are left for later.

**The adapter** (`server/src/adapters/stripe/stripeGateway.ts`) maps Stripe's objects to a few small types (`PaymentEvent`, `RefundInfo`). It is injected through `createApp({ adapters })` like the email and Google adapters, and is `null` when payments are off: the routes then answer 503 `PAYMENTS_UNAVAILABLE`, and the site says payment opens soon. Config refuses any key that isn't `sk_test_` or `rk_test_`.

**Starting a payment** (`POST /commissions/:id/payments/deposit|final`). In one transaction:
1. Lock the commission row.
2. Check the caller is its client and the status is right.
3. Reuse an open Checkout page if it has at least 10 minutes left; otherwise insert a `pending` payment row.
4. Create the Checkout session, with the idempotency key `checkout-payment-<row id>`.
5. Store the session ID, URL, and expiry.

If Stripe fails, the whole transaction rolls back and the client gets a 502. Pages stay open for 60 minutes.

**The webhook** (`POST /webhooks/stripe`) is mounted before the JSON parser with `express.raw`, because the signature covers the exact bytes. It also comes before sessions and the Origin check: Stripe isn't a browser, and the signature proves who sent it. For each verified event, one transaction:
1. Inserts the event ID into `processed_webhook_events` (`ON CONFLICT DO NOTHING`). If it was already there, it answers 200 with `duplicate: true` and stops.
2. Locks the commission, then handles the event:
   - **`checkout.session.completed`:** marks the payment succeeded, and moves the commission:

     | Payment | Moves the commission to |
     | --- | --- |
     | Deposit | `deposit_paid` |
     | Final, digital | `delivered` |
     | Final, physical or mixed media | `ready_to_ship` |

     The system actor makes the change, and the event row records the payment ID and amount.
   - **`checkout.session.expired`:** marks a still-pending payment expired.
   - **`refund.created`, `refund.updated`, `refund.failed`:** update the refund row, or record a refund made in the Stripe Dashboard. Then the commission settles (below).

If any step throws, everything rolls back, including the event ID. The endpoint answers 500, and Stripe retries the event later, handling it in full. Recording the event ID inside the same transaction, rather than before it, is what makes "duplicate = no-op" and "failure = retry" both true.

**Late payments.** If the commission is no longer waiting for the payment, the payment is still recorded (the money did move). Then it is refunded in full, with the idempotency key `auto-refund-<session id>`, inside the same transaction. A rollback and retry therefore gets the same Stripe refund back instead of a second one. To make this rare, cancelling a quoted commission also expires its open Checkout pages. This is best effort, through an `onCommissionStatusChange` hook that `createApp` wires, so the commissions module doesn't import payments.

**Refunds** (`POST /admin/commissions/:id/refunds`). In one transaction:
1. Lock the commission.
2. Check the payment belongs to it and succeeded.
3. Cap the amount at what isn't already refunded or pending.
4. Insert a pending refund row, recording the reason and the admin who asked.
5. Call Stripe with the key `refund-payment-<row id>`.
6. Store Stripe's answer.

A refund Stripe confirms later arrives through the webhook. **Settling:** when the succeeded refunds equal the succeeded payments, and the state machine allows it from the current status, the commission moves to `refunded` through the dedicated `refund` flow. The actor is the requesting admin, or the system for automatic and Dashboard refunds.

**Locking order.** Every flow, whether request or webhook, locks the commission row first, then reads or writes its payments. So a webhook that arrives while the admin's refund is still inside Stripe waits, then sees the committed refund row.

## Consequences

- **Defense in depth on double charges:** reused open pages, expiry on cancel, automatic refunds, unique Stripe IDs, and at most one successful payment per stage.
- **A truly duplicated stage payment can't be stored:** two paid sessions for the same stage at once would hit the "one success per stage" index, and that event would fail and retry until someone looked. Reuse and expiry make this practically impossible, and the error is logged loudly.
- **Holding a database transaction during a Stripe call** keeps each flow atomic and simple. The cost is a held connection for the call's duration (typically well under a second), which is fine at this scale.
- **Not in this milestone:**
  - shipping charges on the final payment, and tax (both arrive with the shipping work);
  - a status change for refunds after the final payment;
  - an admin screen for refunds (the API exists).

  These are recorded in the backlog.
- **The donation ledger (milestone 8)** will create the donation inside the same webhook transaction as the payment.

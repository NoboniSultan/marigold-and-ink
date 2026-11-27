# 18. Shipping labels and tracking

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

Milestone 11a (ADR 0017) lets the client choose and pay for USPS shipping. Milestone 11b finishes the job: the owner buys and prints the label, the package is tracked, the commission moves to `shipped` and `delivered` on its own, and the client hears about it.

What Shippo's documentation and its test mode showed (2026-11-26):
- A rate can only be bought for 7 days after it was quoted. The client's rate may be older than that by the time the owner packs the work.
- Label links expire. `GET /transactions/:id` gives a link to the PDF when asked.
- USPS won't make a label without the sender's **email and phone**. Prices don't need them.
- Webhooks can be signed, but only after asking Shippo's sales team (up to 10 business days). Shippo also suggests a secret token in the webhook link. Its tracking webhooks may repeat.
- Test-mode labels can't be tracked: Shippo answers 400. Shippo provides test tracking numbers (`SHIPPO_TRANSIT`, `SHIPPO_DELIVERED`, ...) under the carrier `shippo`.

The owner decided (2026-11-26):
- A commission is **shipped at the carrier's first scan**, not when the label is bought.
- **Letter-size PDF** labels, for a regular printer.
- If postage went up since the client paid, **buy anyway** and absorb the difference, shown before buying.
- A **Void label** button, emails to the client when the package ships and is delivered, an alert to the owner when it's returned or can't be delivered, and a **daily tracking check** as a backup to the webhook.

## Decision

- **Buying:** the admin page fetches today's prices for the package (a new Shippo shipment), marks the client's service with what they paid, and buys the chosen one. As with the client's choice, only a rate ID is sent. The server reads it back from Shippo and checks it belongs to the latest label prices (`shipments.label_quote_id`). The commission row stays locked while Shippo makes the label, so a double click can't buy two.
- **Labels** are rows in `shipping_labels`: the Shippo transaction, tracking number and link, and what the postage cost. The PDF itself isn't stored: "Print label" asks the server, which gets a link from Shippo and redirects to it.
- **Voiding** asks Shippo for a refund and keeps the row (`voided_at`, refund status). At most one label per shipment isn't voided (a partial unique index). Voiding is allowed until the carrier scans the label. The daily check follows pending refunds.
- **Tracking webhook:** `POST /api/v1/webhooks/shippo?token=…`, outside sessions and the Origin check. The token (`SHIPPO_WEBHOOK_TOKEN`, optional) is compared in constant time and never logged. Only the tracking number in the body is used, to find the label. The tracking itself is always read back from Shippo with the app's own key, so a forged or replayed webhook can at most make the server ask Shippo again.
- **Applying tracking:**
  - The scans are saved to `tracking_events`, at most once each (keyed on Shippo's own ID per scan), and the label's status is updated.
  - The commission moves as the **system** actor: `ready_to_ship → shipped` on the first scan, and `→ delivered` on delivery (through `shipped` if that's the first news). The state machine now lets the system make both moves. The admin still can too.
- **Emails:**
  - The client is emailed after a move to `shipped` or `delivered`, from tracking or when the owner marks it by hand, and only after the change has committed.
  - The owner (every admin account) is emailed once per label if it's returned or can't be delivered.
  - The client wording is the owner's to write. Until then it reads `PLACEHOLDER:`, and in production an email that still has a placeholder is not sent (a warning is logged instead).
- **Daily check:** at startup and every 24 hours, every label still on its way (commission `ready_to_ship` or `shipped`) is refreshed, and so are pending refunds. One failure is logged and the rest carry on.
- **Settings:** `SHIP_FROM_EMAIL` and `SHIP_FROM_PHONE` (needed for labels) and `SHIPPO_WEBHOOK_TOKEN` are optional, so an existing setup keeps starting. Without the contact details, label buying answers 503 `LABEL_SETUP_INCOMPLETE`. Without the token, the webhook answers 404 and the daily check still runs.

## Consequences

- The owner can't buy a label for less than a fresh price, and sees any difference from what the client paid before buying. The studio covers the difference. The report doesn't show it yet (see the backlog).
- If Shippo bought a label but saving it failed, the label is still paid for. Its transaction ID is logged so it can be found and voided in Shippo's dashboard.
- Tracking news can be up to a day late if a webhook is missed. Shippo says updates usually arrive within two hours.
- A carrier "returned" or "failure" status changes nothing on its own. The owner is told and decides what to do.
- The package can't be changed after the final payment. If it turns out to be wrong, the owner can still buy the label from Shippo's dashboard (see the backlog).
- Test-mode labels never move: tracking is tested with fakes, and with Shippo's test numbers directly against the adapter.

# 15. Admin screens and the monthly report

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Until milestone 9 the owner quoted, moved commissions along, refunded, and tracked tree invoices through API calls in a terminal. The owner needs screens for these, and a monthly report of sales and giving (proposal section 8) that can go into bookkeeping. The owner decided: tree invoices are marked paid several at a time (one invoice from the planting partner usually covers several commissions); the report can be downloaded as CSV; months are counted in New York time; and the admin pages show the client's email.

## Decision

- **Screens, not new rules.** The admin area (`/admin`, lazy-loaded, admin only) uses the existing quote, transition, payment, and refund endpoints. New endpoints only gather what the screens need: `GET /admin/commissions` (with each client, from the users service), `GET /admin/commissions/:id` (details, client, and a money summary), `GET /admin/donations`, `POST /admin/donations/mark-paid`, and `GET /admin/reports/monthly` (and `.csv`). A small `admin` module combines other modules' services, so commissions, payments, and users keep no dependency on each other.
- **Marking invoices paid** is all or nothing: every selected donation must exist and be `owed`; the payout date can't be in the future (New York time); the rows are locked in ID order so two batches can't deadlock.
- **The money summary** shows paid, refunded (succeeded or processing), held for trees, still refundable (paid − refunded − tree money, never below 0), and any tree money a Stripe Dashboard refund gave back.
- **The monthly report**, per month of a year up to the current month, in **America/New_York** (`lib/businessTime.ts`):
  - **Sales:** succeeded deposits and final payments, by the day the payment row was created (a Checkout page is paid or expires within a day of opening). **Refunds:** succeeded refunds, the same way. **Net sales:** sales − refunds.
  - **Trees ordered:** tree donations Digital Humani accepted that month (by `requested_at`), as trees and dollars.
  - **Donations paid:** donations whose invoice was paid that month (by `payout_date`).
  - **Owed at month end:** tree money requested by the end of the month and not paid by then.
  - The CSV has the same columns in dollars (exact, from integer cents) and a total row, whose "owed" is the last month's figure, not a sum.

## Consequences

- The owner can run the shop from the site: quote, move, refund, and settle tree invoices, without the terminal.
- Payments are dated by when Checkout started, not when Stripe confirmed them. A page opened before midnight on the last day of a month and paid after it counts in the earlier month; rare, and the report says how it counts. A `succeeded_at` column would fix it if it ever matters.
- There's no admin screen yet for artworks, prices, or users; those still go through content files or the API (backlog).

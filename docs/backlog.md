# Backlog

Work that is out of scope for the current build session (milestones 0 to 8). Each item links back to the relevant section of [proposal.md](proposal.md).

## Deferred features

- **File handling** (proposal 6.5): reference photo uploads to object storage, server-side watermarked previews (Sharp), and final files served through expiring signed URLs.
- **Messaging** (6.7): a message thread per commission. The `messages` table is created in milestone 2; its endpoints come later.
- **Email notifications** (6.7): new messages, payment reminders, status changes, shipping updates, and the donation amount in order confirmations.
- **Background jobs**: BullMQ on Redis for email and scheduled tasks.
- **Slots and waitlist** (6.6): a maximum number of active commissions per period, with automatic promotion from the waitlist.
- **Shipping** (7): addresses, live rates (EasyPost or Shippo), labels, tracking webhooks, insurance, and local pickup for furniture.
- **Shop** (6.10): products, variants, cart, inventory with row-level locking for one-of-a-kind pieces, expiring reservations, and an inventory movement log.
- **Admin dashboard UI and analytics** (6.8): revenue by month, turnaround time, popular styles, best sellers.
- **Public transparency page** (8): the frontend for the running donation total. Its API endpoint comes in milestone 8.
- **Monthly donation report** (8): total sales, donations owed, and donations paid out.

## Ideas and notes

- None yet.

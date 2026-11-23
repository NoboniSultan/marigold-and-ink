# 12. Account deletion by anonymization

- **Status:** Accepted
- **Date:** 2026-11-23

## Context

Clients need to delete their own account, and the privacy policy has to be able to promise it. But a client's commissions, their status history, and their payments reference the `users` row with `ON DELETE RESTRICT` (ADR 0003), because the owner's accounts and the donation ledger depend on them. Removing the row would mean removing financial history.

The owner's decisions for milestone 7c:
- **Anonymize** rather than only disable the account.
- **Block deletion while a paid commission is in progress**: the artist owes the client work, or money is still moving. Unpaid requests (`inquiry`, `quoted`) are cancelled as part of the deletion.
- **Confirm with the password**; an account that only uses Google types its email address instead.
- **Admin accounts can't be deleted from the site**, so the shop can't lose its only admin by accident.

## Decision

`DELETE /api/v1/users/me` runs one transaction (`auth.account.service.ts`):
1. Lock the user row, and check the confirmation (password, or the email for a Google-only account). Refuse an admin.
2. `commissionsService.closeForDeletedClient`: lock the client's commissions. If any is past `quoted` and not finished (`delivered`, `completed`, `canceled`, `refunded`), refuse with `422 ACTIVE_COMMISSIONS` and list them. Otherwise cancel each unpaid request through `applyTransition` (actor: the client, reason "Account deleted"), and clear the free-text `notes` on all of their commissions.
3. Delete their Google identities, any pending sign-up code for their email, and every session.
4. Anonymize the row: `email`, `password_hash`, and `email_verified_at` become `NULL`, `display_name` becomes "Deleted user", and `deleted_at` is set.

After the commit, the usual after-cancel step closes any open Stripe Checkout page for the cancelled requests, and the response clears the session cookie.

The database enforces the result: `users.email` is nullable, and `users_deleted_fields_check` requires that a live account has an email, and that a deleted one has no email, password, or verification date, and is a client. Every user query in the app ignores deleted rows, so to the app the account no longer exists. Because `UNIQUE` treats `NULL`s as distinct, any number of deleted rows can exist, and the email is free to sign up again as a new, unrelated account.

The same milestone adds a password change (`POST /users/me/password`), which signs out every session and starts a fresh one for the browser that made the change. Both password-confirming endpoints are rate-limited per user, counting failures only.

## Consequences

- **Financial history survives** (amounts, dates, statuses, refunds), attached to "Deleted user". The owner's accounts and the donation ledger stay correct.
- **What isn't erased:**
  - **Status-change reasons the client typed** stay in `commission_events`, which is append-only by a database trigger: an audit trail that can be edited isn't one. They're optional, short, and about the commission. If that's ever not acceptable, the trigger would need a narrow, audited exception.
  - **Stripe keeps the client's email** on its own payment records, under Stripe's legal retention rules. The privacy policy should say so.
  - **Backups** keep older copies until they expire (Neon's restore window).
- **A client with a paid commission in progress has to finish or cancel it first**, or contact the owner. That's deliberate: deletion shouldn't silently abandon work that's been paid for.
- **Not built:** changing the email address (it needs a new verification code), and downloading one's data. Both are in the backlog.

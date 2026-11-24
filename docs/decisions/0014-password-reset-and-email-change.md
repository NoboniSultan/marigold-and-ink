# 14. Password reset and email change by emailed code

- **Status:** Accepted
- **Date:** 2026-11-24

## Context

Milestone 5c gave sign-up a 6-digit emailed code (ADR 0010), and milestone 7c gave the account page name and password changes and deletion (ADR 0012). Two things a client can't do yet: get back into an account after forgetting the password, and change the email address. The privacy policy also needs a way for clients to get a copy of their data. Real email now works in production (Resend, `mail.noboni.art`), so emailed codes can carry these flows.

## Decision

- **One code mechanism for three purposes.** `email_verifications` gains a `purpose` (`signup`, `password_reset`, `email_change`); the primary key becomes `(purpose, email)`, so each purpose keeps at most one pending code per address. An email-change code also records the `user_id` it is for (`email_verifications_user_check`: only email-change codes have one). The rules are shared (`auth.codes.ts`): 15 minutes, 5 wrong tries, one new code a minute, only a keyed hash stored. The hash also binds the purpose, so a code for one purpose can never pass as another. Expired codes are deleted whenever a new code is issued.
- **Password reset** (`POST /auth/password-reset/start`, `/complete`): a code is stored for any address, but emailed only to a verified client account. The answer and the cooldown are the same either way, so the form can't reveal who has an account. The new password follows the sign-up rules. Success signs out every session and signs this browser in. Google-only accounts can use it to add a password. **The admin is excluded**: its password comes from `ADMIN_PASSWORD`, which the seed applies on every deploy.
- **Email change** (`POST /users/me/email`, `/users/me/email/confirm`): the account's password confirms the request (Google-only accounts have none; their session is the proof). The code goes to the **new** address, proving the client can read it. If that address already has an account, it gets the "you already have an account" note instead and the answer is the same. Success moves the account (the address counts as verified), signs out every other session, and emails the **old** address that the change happened. The admin's address belongs to `ADMIN_EMAIL`, so the admin can't change it here.
- **Download my data** (`GET /users/me/export`): the account and each commission with its status history, sent quote, and payments, as the client sees them on the site (no Stripe IDs or admin notes), as a JSON file.

## Consequences

- Clients can recover and move their accounts without contacting the owner, and the privacy policy can point to self-service access, correction, and deletion.
- Someone with an unlocked, signed-in browser could move a Google-only account to their own address. The old address is told at once, and password accounts need the password.
- If the old address's notice fails to send, the change still stands (it's logged); the change itself is never held up by it.
- The codes table can hold an address that never became an account for up to 15 minutes, plus until the next code is issued by anyone; a scheduled cleanup comes with background jobs.

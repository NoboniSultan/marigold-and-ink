# Privacy data inventory

What personal data the site collects, where it goes, and how long it stays, taken from the code. It's the factual basis for the privacy policy at `/privacy` (text in `client/src/content/copy.ts`), not the policy itself.

**Keep it current:** any milestone that stores, logs, or sends new personal data updates this file in the same PR. Last checked at milestone 8d.

## 1. Accounts (`users`, `auth_identities`)

| Data | Source | Notes |
| --- | --- | --- |
| Email address | Sign-up form or Google | Required; also the login. Stored case-insensitively. |
| Display name | Sign-up form, or the Google account's name | Up to 100 characters. |
| Password | Sign-up form | Stored only as a bcrypt hash. Google-only accounts have none. |
| Google account ID (`sub`) and Google email | Google sign-in | Only the ID, email, "email verified" flag, and name are read. No profile photo. |
| Role, email-verified date, created/updated dates | The app | |

**Self-service** (the account page, `/account`): see your details and commissions, change your name, password, and **email address** (confirmed by a code sent to the new address; the old address is told), **download your data** (a JSON file of the account and each commission with its history, quote, and payments), and **delete the account**. A forgotten password is reset with a code emailed to the account's address (`/forgot-password`; [ADR 0014](decisions/0014-password-reset-and-email-change.md)). Deletion anonymizes it ([ADR 0012](decisions/0012-account-deletion-by-anonymization.md)): email, name, password, Google link, pending sign-up code, sessions, and commission notes are removed; the commission and payment records stay as "Deleted user" for the shop's accounts. Not removed: status-change reasons the client typed (the history is append-only), Stripe's own copy of the email on payments, and database backups until they expire. Deletion is refused while a paid commission is in progress.

## 2. Emailed codes (`email_verifications`)

- A 6-digit code is emailed to confirm an address: for sign-up, a password reset, or an email change. Only a hash of it is stored, with the email, its purpose, an attempt count, and a 15-minute expiry. An email-change code also stores which account it is for.
- A password-reset code is stored for any address typed in, but emailed only if it has an account.
- The row is deleted when the code is used, when the account is deleted, and once expired, whenever anyone is sent a new code. So an address that never became an account stays at most until the next code is issued.

## 3. Commissions (`commissions`, `commission_events`, `quotes`)

- Size, medium, number of subjects, physical or digital, rush, and a **free-text notes field**. Notes can contain anything the client types, including details about the people or pets in the piece.
- Status history: each change, who made it (client, admin, or system), and when.
- Quotes and prices.

## 4. Payments (`payments`, `processed_webhook_events`)

- **Card details never reach the site.** Clients pay on Stripe's hosted Checkout page.
- Sent to Stripe: the client's email (`customer_email`), the amount and currency, a description such as "Deposit for commission #12", and internal IDs (payment, commission, type).
- Stored: amount, currency, status, Stripe's session, payment intent, and refund IDs, the Checkout link and its expiry, and for refunds, the reason and which admin requested it.
- Payment rows are financial records and can't be deleted while their commission exists (`ON DELETE RESTRICT`).

## 5. Cookies and browser storage

- **One cookie:** the sign-in session cookie. It's `HttpOnly` (scripts can't read it), `Secure`, has no `Domain` (only this host), and expires after 7 days (`SESSION_MAX_AGE_DAYS`). The session row in Postgres (`sessions`) holds the user ID, and briefly the Google sign-in state.
- No analytics, advertising, or tracking. Nothing in `localStorage` or `sessionStorage`.
- Fonts are bundled with the site (`@fontsource`), so no requests go to Google Fonts.
- Stripe Checkout and Google sign-in are on their own domains and set their own cookies under their own policies.

## 6. Logs and security

- Each request is logged with its method, path, status, duration, and a request ID. **No IP address or user agent.** Passwords, `authorization`, and `cookie` values are redacted, and Google's one-time code and state are kept out of logged URLs.
- IP addresses are held **in memory only**, for rate limiting sign-in and sign-up attempts, and are lost on restart.
- Render, as the host, may keep its own request logs under its own terms.
- In development only, sign-up emails (with the code) are written to the server log; production refuses this setting.

## 7. Processors

| Service | Purpose | Data it handles | Where |
| --- | --- | --- | --- |
| Render | Hosting the site and API | All traffic | US (Oregon) |
| Neon | Production database | Everything in sections 1 to 4 | AWS US West (Oregon) |
| Stripe | Payments | Email, amounts, card details (entered on Stripe's page) | Stripe's infrastructure |
| Google | "Continue with Google" | That the person is signing in to this app | Google's infrastructure |
| Resend | Sign-up emails (once configured) | Email address and the code | Resend's infrastructure |
| Digital Humani | Requesting trees for fully paid commissions (once configured) | **No personal data:** a reference like `commission-12` and a number of trees | Digital Humani's infrastructure (Canada) |

All the site's own data is stored in the United States.

## 8. Not built yet (update this file when they are)

- **Reference photo uploads** (milestone 8): the `files` table exists but is unused.
- **Messaging:** the `messages` table exists but is unused.
- **Shipping addresses** (proposal section 7).

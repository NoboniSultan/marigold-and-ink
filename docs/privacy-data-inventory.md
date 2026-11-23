# Privacy data inventory

What personal data the site collects, where it goes, and how long it stays, taken from the code. It's the factual basis for the privacy policy at `/privacy` (text in `client/src/content/copy.ts`), not the policy itself.

**Keep it current:** any milestone that stores, logs, or sends new personal data updates this file in the same PR. Last checked at milestone 7c.

## 1. Accounts (`users`, `auth_identities`)

| Data | Source | Notes |
| --- | --- | --- |
| Email address | Sign-up form or Google | Required; also the login. Stored case-insensitively. |
| Display name | Sign-up form, or the Google account's name | Up to 100 characters. |
| Password | Sign-up form | Stored only as a bcrypt hash. Google-only accounts have none. |
| Google account ID (`sub`) and Google email | Google sign-in | Only the ID, email, "email verified" flag, and name are read. No profile photo. |
| Role, email-verified date, created/updated dates | The app | |

**Self-service** (the account page, `/account`): see your details and commissions, change your name and password, and **delete the account**. Deletion anonymizes it ([ADR 0012](decisions/0012-account-deletion-by-anonymization.md)): email, name, password, Google link, pending sign-up code, sessions, and commission notes are removed; the commission and payment records stay as "Deleted user" for the shop's accounts. Not removed: status-change reasons the client typed (the history is append-only), Stripe's own copy of the email on payments, and database backups until they expire. Deletion is refused while a paid commission is in progress.

## 2. Sign-up codes (`email_verifications`)

- A 6-digit code is emailed to confirm an address. Only a hash of it is stored, with the email, an attempt count, and a 15-minute expiry.
- The row is deleted when the account is created. A code that is never used stays until a new code for that address replaces it (backlog: clean up expired rows).

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

All the site's own data is stored in the United States.

## 8. Not built yet (update this file when they are)

- **Data download and email change:** there's no self-service export of an account's data, and the email address can't be changed (it needs a new verification code). Requests go to the owner by email.
- **Reference photo uploads** (milestone 8): the `files` table exists but is unused.
- **Messaging:** the `messages` table exists but is unused.
- **Shipping addresses** (proposal section 7).

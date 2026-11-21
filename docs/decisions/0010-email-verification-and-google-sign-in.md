# 10. Email-verified sign-up and Google sign-in

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

The owner asked for two things:
- **"Continue with Google":** authorization code flow with PKCE and state, the scopes `openid email profile`, users identified by Google's `sub`, `email_verified` required, linking to an existing account when the verified email matches, and never granting admin.
- **A code emailed to every new account,** with unverified accounts unable to log in.

Until now, registration created a logged-in account immediately and never checked the email. That allows **account pre-hijacking**:
1. An attacker registers the victim's email with a password of their choosing.
2. If Google later links to that account by email, the attacker's password still works.

The owner's admin email is a Gmail address, so Google sign-in would also match the admin account.

## Decision

**Email sign-up verifies before the account exists.**
- **Step 1** (`POST /auth/signup/start`) emails a 6-digit code.
- **Step 2** (`POST /auth/signup/complete`) takes the code, name and password, and only then creates the account (verified) and logs in.
- So no unverified account can be created anymore, and pre-hijacking new accounts is impossible.
- **Code rules:**

  | Rule | Value |
  | --- | --- |
  | Generator | cryptographic RNG |
  | Storage | HMAC-SHA256 keyed with `AUTH_SECRET` and bound to the email |
  | Valid for | 15 minutes |
  | Wrong tries | 5 |
  | Resend cooldown | 60 seconds |

  The resend cooldown is enforced in one SQL statement, so simultaneous requests can't bypass it.
- **No probing:** step 1 answers identically whether or not the email has an account. An existing member gets "you already have an account" by email instead of a code.
- **Old accounts:** accounts created before this change (unverified) can't log in (`403 EMAIL_NOT_VERIFIED`, and only after a correct password). Their owner claims them with a code, which sets a new password.

**Email is sent through Resend** (HTTP API, no SDK), as an injected adapter.
- In development, a "log" transport prints codes to the server log. Config refuses it in production.
- Without a configured transport, production email sign-up reports "opens soon" (503 `EMAIL_SIGNUP_UNAVAILABLE`). The owner has no domain yet, and a domain is required to email customers.

**Google uses openid-client** (certified, maintained by an author of the OpenID specs), as an injected adapter.
- **Checks:** PKCE (S256), state, and nonce. ID-token claims are validated, and signatures are checked against Google's keys (`enableNonRepudiationChecks`).
- **Pending sign-in:** the one-time values live in the visitor's session for at most 10 minutes and are consumed by the callback, whether or not it succeeds.
- **Matching:** users are matched by `sub` in `auth_identities`, and the session is regenerated on sign-in.
- **Linking** to an existing account with the same verified email:
  - if that account's email is verified, link and keep its password;
  - if not, link, **remove the password, and sign out its sessions** ("option A"), because whoever set that password may not own the email.
- **Admin accounts can never sign in with Google.**
- Off unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PUBLIC_URL` are all set.

Rejected:
- **Passport's Google strategy:** it reads the userinfo endpoint instead of verifying the ID token, and is less maintained.
- **Linking while keeping every password ("option C"):** it leaves pre-hijacking open.

## Consequences

- Sign-up needs working email. Production email sign-up stays closed until the owner verifies a domain in Resend (`docs/setup-google-and-email.md`). Google sign-in works as soon as its keys are set.
- `users.password_hash` is now nullable (Google-only accounts). Login treats a missing password exactly like a wrong one, timing included.
- Password reset becomes possible later on the same code mechanism (backlog).
- Tests use fake email and Google adapters (`createApp({ adapters })`). The real Google flow needs the owner's Cloud Console setup to try end to end.

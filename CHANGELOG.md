# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with one entry per milestone.

## [Unreleased]

## [0.11.0] - 2026-11-24 (Milestone 10: files)

### Added

- **Commission files** in a private Cloudflare R2 bucket ([ADR 0016](docs/decisions/0016-commission-files-on-r2.md); setup in `docs/setup-r2.md`; off until configured):
  - **Reference photos:** clients add up to 10 (JPEG, PNG, or WebP, 15 MB each) right after sending a request or on the commission's page, and can remove them, until work starts. Each is re-encoded upright, at most 2400 px, **with all metadata removed** (no GPS, camera, or time).
  - **Previews:** the owner uploads work in progress from the admin commission page; the server **watermarks** it ("Marigold & Ink · PREVIEW", tiled) before storing, so no clean copy is kept. Clients see them on their commission's page.
  - **Final files:** the owner uploads the deliverable (JPEG, PNG, PDF, or TIFF, up to 100 MB), stored as is; the client gets a **download** button once the commission is paid in full, with the date it stays available until.
  - **Privacy and safety:** the real file type is read from its bytes; every read is a signed link that expires in 10 minutes; the security policy allows images from the bucket only; at most 60 uploads an hour per user.
  - **Automatic deletion:** reference photos 90 days after a commission ends; previews and finals a year after full payment (or 90 days after an unpaid end); a sweep runs at startup and daily. **Account deletion** removes the client's reference photos.
- **API:** `GET /commissions/:id/files`, `POST /commissions/:id/files/references`, `DELETE /commissions/:id/files/:fileId`, `POST /admin/commissions/:id/files/previews` and `/finals`.
- **Migration:** `files.width`/`height` and the file-name rule, with constraints.
- **Dependencies:** `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (3.1165.0, exact) for R2's S3 API; `sharp` moves to production dependencies (it was dev-only for `npm run media`).
- **Tests:** 43 new server tests (960 in all: uploads, limits, types, metadata stripping, watermarking, visibility, deletion, the expiry sweep, account deletion, the adapter with a fake S3 client, config, constraints, the security policy) and 7 new client tests (147 in all).

### Changed

- Helmet's Content-Security-Policy now names `img-src` explicitly: the site, `data:`, and the R2 bucket once configured.
- The privacy data inventory covers files and R2; the owner adds a part to the privacy policy before switching uploads on (backlog).

## [0.10.1] - 2026-11-24 (Milestone 9b: the terms of service)

### Added

- **The owner's terms of service** at `/terms` (`client/src/content/terms.md`, Markdown like the privacy policy), linked from the footer, and loaded on demand. Two factual fixes to the owner's draft: account deletion *does* cancel unpaid requests and is refused while a paid commission is in progress (section 2), and the Giving page link points to `/giving` (section 6); "account dashboard" links to `/account`.
- `RichText` reads links inside bold text (`**[text](/path)**`).
- **Tests:** 2 new client tests (140 in all).

### Changed

- The 50% deposit and two included revisions are the owner's own values now (stated in the terms), not placeholders. The Google setup guide covers the terms link and brand verification; the backlog records quote expiry (the terms say 14 days; not enforced yet).

## [0.10.0] - 2026-11-24 (Milestone 9: admin screens)

### Added

- **The admin area** (`/admin`, an "Admin" link in the header for the admin only; loaded on demand; [ADR 0015](docs/decisions/0015-admin-screens-and-monthly-report.md)):
  - **Commissions:** every request with its client's name and email, filterable by status. Each commission's page shows its details; **generates, adjusts, and sends the quote**; offers the **status moves** the state machine allows (cancelling asks first); and shows its **money**: paid, refunded, held for trees, still refundable, with a warning if a Stripe Dashboard refund gave back tree money, and a **refund form** that respects the tree-money rule.
  - **Giving:** tree donations owed, paid, and waiting for Digital Humani. **Tick several owed donations and mark them paid with one invoice** (payout date, receipt number); all or nothing.
  - **Monthly report:** per month (New York time) sales, refunds, net sales, trees ordered, donations paid, and tree money owed at month end, with the year's total and a **CSV download**.
- **API:** `GET /admin/commissions`, `GET /admin/commissions/:id`, `GET /admin/donations`, `POST /admin/donations/mark-paid`, `GET /admin/reports/monthly` (and `.csv`). Quotes, status changes, and refunds use the existing endpoints.
- **The privacy policy's contact address**, `hello@noboni.art` (forwarded through Porkbun), and email links in the site's copy (`[text](mailto:…)`).
- **Tests:** 24 new server tests (917 in all; every admin route: happy path, validation, 401, 403; the New York month boundary; the CSV) and 17 new client tests (138 in all: the admin guard, each admin page, the dollars-to-cents parser).

### Changed

- `formatMoney` moved to `features/commissions/money.ts`; the Stripe guide's quote step points to the admin screen.
- Initial JavaScript per page is unchanged (about 171 KB gzipped); the bundler now folds a shared chunk into the main one, and the admin pages are separate chunks.

## [0.9.4] - 2026-11-24 (Milestone 8e: the privacy policy)

### Added

- **The owner's privacy policy** at `/privacy`, in `client/src/content/privacy.md` (Markdown, so the owner can edit it directly). Three factual updates were made to the owner's draft so it matches milestone 8d (password reset and email change codes, self-service email change and data download, Resend as an active service), plus in-site links to the Giving and account pages. The contact email is still a `PLACEHOLDER`.
- **A small, safe Markdown renderer** (`components/Markdown.tsx`): headings (with linkable IDs), paragraphs with line breaks, bullet lists, and inline `RichText`. React elements only, never raw HTML.
- `RichText` also renders `` `code` `` and same-site links (`/giving`), which stay in the app; `//other-site` is never treated as same-site.
- The Privacy page is loaded on demand (about 7 KB gzipped), so the main bundle stays at 164 KB.
- **Tests:** 7 new client tests (121 in all).

### Changed

- The backlog records the contact email, publishing the Google sign-in app, the live site's admin login, and quoting commission #2 on the live site.

## [0.9.3] - 2026-11-24 (Milestone 8d: account recovery, email change, and data download)

### Added

- **Forgot password** (`/forgot-password`, linked from the login page; [ADR 0014](docs/decisions/0014-password-reset-and-email-change.md)): a 6-digit code emailed to the account's address, then a new password, which signs out every other device and signs this browser in. The page answers the same for any address, so it never reveals who has an account. Google-only accounts can use it to add a password; the admin can't (its password is in the server settings).
- **Change your email** on the account page: the password confirms it (none for Google-only accounts), a code goes to the new address, and the old address is told once the account has moved. Other devices are signed out.
- **Download my data** on the account page: a JSON file with the account and each commission's history, quote, and payments, as the client sees them.
- **A warning in the server log** when a refund made in the Stripe Dashboard reaches into tree money (the site can't stop those).
- **Migration:** `email_verifications` gains `purpose` and `user_id`, keyed by `(purpose, email)`, with constraints and indexes; expired codes are deleted whenever a new one is issued.
- **Tests:** 38 new server tests (password reset, email change, data export, the Dashboard-refund warning, constraints; 893 in all) and 9 new client tests (114 in all).

### Changed

- Sign-up, password reset, and email change share one set of code rules (`auth.codes.ts`); sign-up behaves exactly as before.
- Privacy inventory, data model, backlog, and README updated; the backlog loses the items built here (and real email and the Giving page, already done).

### Fixed

- **Two-step forms reused the first step's input:** when the code step's layout lines up with the email step's, React kept the typed email in the code box. Each step's form now has its own key (found by the new forgot-password test; sign-up and the account page got the same safeguard).

## [0.9.2] - 2026-11-24 (Milestone 8c: fixes from the first live Digital Humani test)

### Fixed

- **Retrying a tree request after a lost answer** ([ADR 0013](docs/decisions/0013-giving-through-digital-humani.md), amended): the retry assumed `GET /tree?user=` lists a reference's requests, but the live sandbox answers only a count (`{ enterpriseId, user, count }`), and the API can't list requests. The adapter now counts (`countTrees`), and a retry plants only the trees missing under the commission's reference, so trees are still never ordered twice. Migration: `donations_requested_fields_check` now requires only `requested_at` for owed or paid trees, since a donation adopted from the count has no request ID. Found by a sandbox round trip with the owner's keys (1 tree under `setup-check`).
- **Tests never use a developer's real third-party keys:** `vitest.config.js` blanks the Digital Humani, Resend, and Google settings, so keys in `.env` can't switch a service on in a test (they had turned giving on in a local run).

### Changed

- **Resend setup guide rewritten** for noboni.art: send from the subdomain `mail.noboni.art` (Resend's advice: it keeps sending reputation apart from the main domain), the exact DNS records to add at Porkbun (the registrar), and the `EMAIL_FROM` address to match.

### Added

- **Tests:** the adapter's count uses the real answer shape; a retry plants only the missing trees, adopts trees already counted without a request ID, and never counts on a first attempt; the relaxed constraint (855 server tests in all).

## [0.9.1] - 2026-11-23 (Milestone 8b: the 3D sketchbook)

### Changed

- **Home's featured work is now a 3D sketchbook**, replacing the slideshow (it first replaced the gallery's overstimulating cylinder room, then moved to Home at the owner's request):
  - a book on a **chalkboard** (black, with chalk dust and faint eraser haze) that **opens every time Home loads**: a closed Ink cover with the **Marigold & Ink logo** and name, then the cover swings over the spine as the book glides to the middle;
  - **one more swipe shuts it:** back from the first page, the front cover swings shut; forward from the last, the last page turns and the back cover shuts over it. One more the other way opens it again;
  - one artwork per spread: the piece on the right page, whole and at its own proportions, and its caption (title, medium and year, credit, "3 / 18") on the left; seen at a gentle angle (0.3 rad);
  - **pages move like paper:** each page is a strip of springs, so the edge lifts first, trails through the turn, and floats down. **Dragging holds the page**: it follows the finger and carries on over (or falls back) when let go. Sideways trackpad swipes, the arrow keys, and the buttons below the book (title and "N of 18") turn one page at a time;
  - **vertical scrolling is never captured**, so the book doesn't trap anyone scrolling down Home;
  - clicking the open page goes to that piece's page in the gallery;
  - phones frame the right-hand page; without WebGL the same controls show the piece flat; reduced motion starts open and changes pages without turning;
  - only pages near the open spread get textures, and the book (three.js) loads after the rest of Home, about 248 KB gzipped.
- **The owner chooses what's in the book:** `"sketchbook": false` in `content/artworks.json` leaves a piece out (migration: `artworks.in_sketchbook`, default true; API: `inSketchbook`). 19 pieces are left out, so the book holds 18; every piece is still in the gallery.
- **The gallery is grid-only:** the Grid / Explore toggle and `?mode` are gone.
- **Digital Humani setup guide corrected:** the sandbox is a separate dashboard at my.sandbox.digitalhumani.com (same login), not a switch in the main dashboard; the guide also explains choosing a One Tree Planted project from Digital Humani's project list.
- **Pet Portrait 2 is now "Benito" (owner's title), at `/gallery/benito`.

### Removed

- The Home slideshow (`FeaturedCarousel`) and the gallery's 3D cylinder, with `@react-three/drei` and `@react-three/postprocessing`.

### Added

- **Tests:** 25 client tests for the sketchbook's arithmetic (the paper model never passes through the book or stretches, the edge leads then trails, turns settle; turn and cover timing; shutting at both ends; dragging and release; one page per swipe) and 3 Home page tests for the book's picks, controls, keys, shutting and reopening, and opening a piece, drawn flat as without WebGL (105 client tests in all), and 2 server tests for `sketchbook` in the content file and `inSketchbook` in the API (853 server tests in all).

## [0.9.0] - 2026-11-23 (Milestone 8: giving through Digital Humani)

### Added

- **Trees for every fully paid commission** ([ADR 0013](docs/decisions/0013-giving-through-digital-humani.md)):
  - when the final payment succeeds, 25% of the full price becomes trees, at $1 each, rounded up ($110 → 28 trees), and is recorded in the donations ledger in the same transaction;
  - the trees are requested from **Digital Humani** after the payment commits, so an outage there never affects a payment;
  - failed requests stay pending and are retried after the next payment and at startup. A retry checks what Digital Humani already has (by the reference `commission-<id>`), so trees are never ordered twice;
  - Digital Humani receives no personal data, only that reference.
- **Refunds never give back the tree money** (the owner's decision): once a commission is fully paid, its refunds stop at paid − refunded − tree cost. Errors include `details.withheldForTreesCents`. Refunds before the final payment are unchanged.
- **The Giving page** (`/giving`), in the owner's words ("I plant trees through Digital Humani"), linked from the footer:
  - a seed → sprout → tree drawing that grows on scroll up to the stage reached (sprout at 50 trees, tree at 200), with flubber and Motion's `useTransform`;
  - "N trees funded so far";
  - reduced motion shows the stage without morphing;
  - loaded on demand, so the main bundle doesn't carry flubber.
- `GET /api/v1/giving` (public): `{ trees }`.
- **Digital Humani adapter** (`adapters/digitalHumani.ts`, sandbox or production) and configuration: `DIGITALHUMANI_API_KEY`, `_ENTERPRISE_ID`, `_PROJECT_ID`, `_ENVIRONMENT`, and `DONATION_PERCENT` (no code default; 25 in `render.yaml`). `production` is refused while Stripe is test-only.
- **Migration:** tree columns on `donations`, with constraints (exactly $1 a tree; owed means requested; one row per Digital Humani request). The seed makes "One Tree Planted (through Digital Humani)" the active charity unless the owner chose another.
- **Docs:** ADR 0013, `docs/setup-digital-humani.md`, the data model, the privacy inventory (Digital Humani as a processor with no personal data), the motion doc, README, and backlog.
- **Tests:**
  - 44 new server tests (851 total): the arithmetic; the webhook → donation → request flow; replays; retries, including a lost answer; the refund cap; the public total; the seed; config; the adapter, with a fake fetch; and the constraints. The giving module and adapter have 100% coverage thresholds;
  - 10 new client tests (91 total).

### Changed

- The footer's charity line links to the Giving page, and the footer links wrap on phones.

### Fixed

- Two flaky tests seen on CI: the giving retry tests now wait for the webhook's background tree attempt before retrying, and account deletion commits the move home (`flushSync`) before signing out, so the sign-in guard can't redirect to `/login` first.

## [0.8.4] - 2026-11-23 (Milestone 7e: gallery and home polish)

### Changed

- **Black-and-white pieces come first in the gallery.**
  - `npm run media` measures each photo: a piece counts as black and white if under 2% of its pixels are strongly coloured. Ink and pencil on white, cream, or toned paper pass; paint doesn't.
  - Measured pieces: 23 black and white, 14 colour. **Pet Portrait in Ink** is marked black and white by hand in `content/artworks.json`, because its photo includes a wooden table.
  - The API returns `image.monochrome`, and the list orders by it before the owner's order.
- **The grid no longer crops artworks.** It uses justified rows: every image is whole at its own proportions, and each row fills the width.
- **3D Explore:** black-and-white and coloured pieces are spread through each other instead of grouped. (A scattered, larger layout was tried and dropped: too busy. The owner is choosing a calmer 3D idea to replace the cylinder.)
- **Home:**
  - the typewriter lines: "Art you can hold onto.", "Charcoal, ink, acrylic, and clay.", "Every commission plants trees.", drawn from the owner's About text;
  - the button: "Commission a piece";
  - **the featured carousel mixes black-and-white and coloured pieces** (the first five after mixing), instead of showing the gallery's first five, which are now all black and white;
  - **the featured carousel is larger on desktop:** the stage is up to 84% of the window's height (max 56rem), and the caption takes less of it. Phones are unchanged.
- **About:** the page title is now "A little about me" (the bio's opening heading) instead of "About".

### Added

- **Migration:** `artworks.is_monochrome`, with the index `artworks_published_order_idx`, which replaces `artworks_published_sort_idx`.
- **Tests:**
  - server: the measurement on drawings, paint, and toned paper; measuring old manifest entries from their thumbnails; the content override; the API order;
  - client: `mixTones`, and the About title.

## [0.8.3] - 2026-11-23 (Milestone 7c: account page and account deletion)

### Added

- **An account page** (`/account`, linked as "Account" in the header when signed in):
  - your details and how you sign in (password, Google, or both);
  - change your name;
  - your commissions, each linked to its page;
  - change your password, for accounts that have one;
  - delete your account.
- **Account deletion anonymizes the account** ([ADR 0012](docs/decisions/0012-account-deletion-by-anonymization.md)):
  - removes the email, name, password, Google link, pending sign-up code, sessions, and commission notes;
  - keeps the commission and payment records as "Deleted user" for the shop's accounts;
  - **confirmed with the password**, or by typing the email for a Google-only account;
  - **refused while a paid commission is in progress** (`422 ACTIVE_COMMISSIONS`, listing them). Unpaid requests are cancelled, and their open Stripe pages closed;
  - admin accounts can't be deleted from the site;
  - the email can sign up again as a new account.
- **Password change** signs out every session, then starts a fresh one for this browser.
- **Endpoints:** `PATCH /users/me`, `POST /users/me/password`, `DELETE /users/me`. `GET /users/me` adds `hasPassword` and `hasGoogle`. The two password-confirming endpoints are rate-limited per user, counting failures.
- **Migration:** `users.deleted_at`; `users.email` is nullable, only for deleted accounts (`users_deleted_fields_check`). Every user query ignores deleted rows.
- **Tests:**
  - 24 new server tests (800 total): every endpoint's happy path, validation, unauthenticated, and forbidden cases; deletion with each kind of commission; the after-cancel step; and the new constraint;
  - 12 new client tests (78 total).

### Fixed

- The migration rollback tests now start from empty tables. They had passed only because no earlier test file happened to leave rows that old down migrations can't handle.

### Changed

- The commission status texts moved to `client/src/features/commissions/statusText.ts`, shared by the commission page and the account page.
- **Docs:** ADR 0012, the data model, the privacy data inventory (deletion now available, and what it can't erase), the README (features, API, error codes), and the backlog (email change, data download).

## [0.8.2] - 2026-11-22 (Milestone 7d, part 1: the full gallery)

### Changed

- **All 37 artworks are published** (previously 7), in the owner's grouping:
  - **portraits** (20): examples of the commissions on offer, including the pet portraits. The old works are titled "Untitled 1" to "Untitled 7", and IMG_0177 is "Untitled";
  - **explorations** (14): pieces to see but not offered (acrylic and clay works, the painted bench, door, deck, heels, and dolls), plus the replicas of other artists' work. **Embrace** moved here from portraits, since it's a replica too;
  - **cards** (1): the greeting card, to be sold at a fixed price once the shop exists.
- Other titles come from the file names; mediums are filled in only where the file name says them. Alt text falls back to the title until the owner describes each piece.

## [0.8.1] - 2026-11-22 (Milestone 7b: custom domain and privacy page)

### Added

- **The site's address is now `https://noboni.art`** (`PUBLIC_URL` in `render.yaml`). In production, page requests on any other address, such as the onrender.com one or `www.`, get a 301 redirect there, keeping the path. Google sign-in and the session cookie only work on that one address. The Stripe webhook and the health check answer on every address, because Stripe doesn't follow redirects. Only GET and HEAD are redirected, so a form sent from an old tab still gets an answer.
- **A Privacy page** (`/privacy`), linked from the footer, which Google requires before the sign-in app can be published. Its text is placeholders in `client/src/content/copy.ts` until the owner writes it.
- **`docs/privacy-data-inventory.md`:** what the site collects, stores, logs, and sends to whom, taken from the code, as the basis for the policy.
- **About page text** from the owner, in two sections, with subheadings: a bio entry in `content/about.json` can now be `{ "heading": "..." }` between paragraphs.
- **The footer's charity line** now uses the owner's text.

### Changed

- **Docs:** the Google guide covers publishing the app (homepage, privacy link, authorized domain) and moving to a new domain. The Stripe guide and README use the new address. Backlog: account page and deletion, cleanup of unused sign-up codes, and the privacy policy text.

## [0.8.0] - 2026-11-22 (Milestone 7: Stripe payments, test mode)

### Added

- **Stripe Checkout for the deposit and the balance:**
  - `POST /commissions/:id/payments/deposit` (while `quoted`) and `.../final` (while `awaiting_final_payment`), for the commission's own client only;
  - the amount always comes from the stored quote, never the request;
  - a second click while the page is open gets the same page back;
  - cards only, in USD (the owner's choice).
- **The Stripe webhook** (`POST /webhooks/stripe`):
  - raw body, signature checked, no session or Origin check;
  - each event is handled once, in one transaction that first records its ID. A duplicate delivery does nothing, and a failure rolls back for Stripe to retry;
  - a paid deposit moves the commission to `deposit_paid`. A paid balance moves it to `ready_to_ship` (physical, mixed media) or `delivered` (digital). An expired page is recorded;
  - **a payment that arrives after the commission was cancelled is refunded automatically** (the owner's choice), and cancelling a quoted commission closes its open Stripe page.
- **Refunds:**
  - `POST /admin/commissions/:id/refunds`, full or partial, capped at what's left, with a required reason and the requesting admin recorded;
  - refunds made in the Stripe Dashboard are recorded from the webhook;
  - **the commission becomes `refunded` only once everything paid has been refunded** (the owner's choice). Partial refunds, and refunds after the final payment, move money only.
- `GET /commissions/:id/payments`: the payment history (refund notes are admin-only), plus whether online payment is on and the currency.
- **Stripe adapter** (`stripe` 23.1.0): the only code that imports the SDK. Every create call carries an idempotency key, and config refuses live keys.
- **Site:** a commission page (`/commissions/:id`) with the status, details, price, payments, and a "Pay deposit" / "Pay balance" button. Back from Stripe, it confirms the payment (re-checking until the webhook arrives) or notes a cancel. The request form's confirmation links to it.
- **Configuration:** `STRIPE_SECRET_KEY` (test keys only), `STRIPE_WEBHOOK_SECRET`, `PAYMENT_CURRENCY` (`usd` in `render.yaml`). Payments stay off until both secrets are set.
- **Migration:** `payments.checkout_url`, `checkout_expires_at` (to reuse an open page), `reason`, and `requested_by_user_id` (for refunds), with constraints.
- **Docs:** ADR 0011, `docs/setup-stripe.md` (a local test deposit with the Stripe CLI, and going live in test mode), and README sections for local webhook testing, the endpoints, and the error codes.
- **Tests:** 69 new server tests (768 total) and 11 new client tests (65 total). They cover:
  - valid and invalid signatures;
  - **a replayed webhook with no extra effect**;
  - the deposit and final payment flows;
  - wrong-state payments (refused at checkout, auto-refunded by the webhook);
  - a rollback when a step fails, followed by a successful retry;
  - refunds: full, partial, pending then confirmed, failed, and from the Dashboard;
  - the cancel hook.

  The real adapter's requests (parameters and idempotency headers) are checked offline through the SDK's fetch client. The payments service, webhook handler, and repository have 100% coverage thresholds.

### Changed

- `applyTransition` has a JSDoc type, so TypeScript callers see which fields are optional.

## [0.7.1] - 2026-11-22 (Milestone 6: review and fixes)

No new features. A review of open TODOs, flaky tests, lint warnings, missing tests and docs, plus a security, accessibility and code review; only the approved fixes were made.

### Security

- **Return paths after sign-in:** `/\evil.example` (which browsers read as `//evil.example`) and paths with tabs or other control characters are refused. Both the server and the site use the same rule.
- **Claiming an old, unverified account with an emailed code** now signs out its other sessions, as Google sign-in already did.
- **Google's one-time sign-in code and state** are no longer written to request logs.

### Fixed

- **Gallery past the last page:** the API reports the real `total` instead of 0, and the site says there's no such page and offers page 1, instead of "No artworks match".
- **A failed logout** shows a message instead of failing silently; the button is disabled while it runs.
- **`EMAIL_TRANSPORT=resend` now also requires `PUBLIC_URL`,** so emails never say "log in at /login".
- **A Google callback with no sign-in in progress** no longer stores an empty session row.
- **The header on phones** is one row again (73px instead of 163px). The "Commission a piece" button was meant to hide there, but the shared button style loaded later and overrode the rule.
- **Accessibility:**
  - keyboard focus stays inside the artwork dialog;
  - the gallery search box and tag menu borders went from about 1.2:1 to about 6:1 contrast;
  - every commission form error (medium, delivery and rush included) is shown and linked to its field for screen readers.

### Changed

- **Client test coverage:** `npm run test:coverage` in `client/` (`@vitest/coverage-v8`), now run by CI. It measures 91% of lines and 80% of branches, with a floor of 88% / 76%. The WebGL scene is excluded (jsdom can't run it), but its layout math is tested.
- **Code tidy-up:**
  - the commission event queries name their columns instead of using `SELECT *`;
  - removed two unused gallery repository functions, and type casts in the Google service (it never returns the password hash);
  - corrected comments that described code that doesn't exist.
- **Docs:**
  - **README:** the API table is whole again, plus three missing error codes, the correct `adapters/` description, and a note to run one server test suite at a time;
  - **Other docs:** corrections to the TypeScript guide, the architecture module map, and two constraints in the data model;
  - **Backlog:** the migration-tool advisory (below) recorded; a resolved dev-only advisory removed.

### Checked

- **Flaky tests:** none found in 20 full server runs, 8 of them in shuffled order. The one earlier failure matched two runs sharing the test database at once.
- **Lint and TODOs:** no lint warnings and no TODO markers in either package.
- **Tests:** 14 new server tests (699 total) and 5 new client tests (54 total), covering:
  - each fix above;
  - missing 401 and 400 cases on the quote, events, and admin routes;
  - the request logger;
  - the "on" case for `/auth/providers`.

  The visible changes were also checked in Chrome at desktop and phone widths.
- **Dependencies:** the client has no advisories. The server has 3 moderate ones, all inside `node-pg-migrate` (`glob`, `minimatch`). They run only during migrations, on our own patterns, so they're left for an upstream update (see the backlog).

## [0.7.0] - 2026-11-21 (Milestone 5c: verified sign-up and Google sign-in)

### Added

- **Email-verified sign-up in two steps:**
  - `POST /auth/signup/start` emails a 6-digit code: hashed at rest, valid 15 minutes, 5 tries, one per minute per address.
  - `POST /auth/signup/complete` takes the code, name and password, creates the account already verified, and logs in.
  - Step 1 answers the same whether or not the email has an account (members get an "already have an account" email), so it can't be used to probe emails.
  - Nobody can open an account with an address they can't read.
- **"Continue with Google":**
  - the OpenID Connect code flow with PKCE, state, and nonce (openid-client), with ID-token signature and claim checks;
  - only the `openid email profile` scopes; people matched by Google's permanent ID; a verified email required; the session regenerated;
  - links to an existing account with the same verified email. A verified account keeps its password; an unverified account's password is removed and its sessions signed out;
  - admin accounts can never sign in with Google.
- `GET /auth/providers`: which sign-in methods are on. The site shows the Google button and email sign-up accordingly.
- **Email through Resend,** as an injected adapter. In development, codes print to the server log; config refuses that in production. Production email sign-up says "opens soon" until a domain is verified.
- **Configuration:** `PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`. All are optional, in complete groups, validated at startup.
- **Migration:** `users.email_verified_at` (admins backfilled), nullable `password_hash` (Google-only accounts), `auth_identities`, `email_verifications`.
- **Site:** a two-step sign-up page (code, resend countdown, "use a different email"), Google on login and sign-up, readable messages for every Google failure, and a "get a code" path for unverified accounts.
- **Docs:** `docs/setup-google-and-email.md` (Google Cloud Console and Resend, step by step) and ADR 0010.
- **Tests:** 33 new server tests (685 total) and 6 new client tests (49 total). They use fake email and Google adapters and cover:
  - new, returning, and linked users;
  - an unverified Google email, a state mismatch, replay, expiry, and cancelling;
  - admins refused; code attempts, expiry, cooldown, and binding to one address.

  The sign-up flow was also checked end to end in Chrome.

### Changed

- **`POST /auth/register` is removed;** sign-up is the two steps above.
- **Accounts created before this release** (never verified) can't log in until claimed with a code (`403 EMAIL_NOT_VERIFIED`, only after a correct password).
- The users module and the auth controller are now TypeScript.

## [0.6.0] - 2026-11-21 (Milestone 5b: the website)

### Added

- **The React site** (`client/`, TypeScript): Vite, React 19, React Router 8, TanStack Query, CSS Modules on the brand tokens, self-hosted fonts, and the square logo with a thin Ink border.
  - **Home:**
    - the typewriter hero on CSS-only notebook paper (custom `useTypewriter`);
    - a user-controlled featured carousel with three layered, direction-aware transitions, custom arrows, a progress bar, keyboard and swipe.
  - **Gallery:**
    - Grid mode with category, tag, search and pages, all in the URL, and a shared-layout morph into a full-screen detail view (Escape, backdrop, and close button; scroll lock);
    - a 3D Explore mode (React Three Fiber cylinder with eased rotation, hover tilt, and subtle depth of field), code-split so three.js loads only when opened.
  - **About:** an ink-spread photo reveal, the bio, and a closing photo. Each artwork also has its own page.
  - **Accounts and commissions:** login and register; a protected commission form built from the priced options, showing the server's errors.
  - **Throughout:** reduced-motion fallbacks everywhere, accessible focus rings, skip link, and live regions.
- `GET /auth/session` (always 200: the user or `null`) and `GET /pricing/options` (what can be requested, without prices).
- **Express serves the built site** (same origin): hashed assets are cached for a year, and page URLs fall back to `index.html`; the strict CSP is unchanged.
- **Content:**
  - descriptive photo names (e.g. `embrace.jpg`, `artist-with-flowers.jpg`);
  - *Embrace* credited "after Oswaldo Guayasamín";
  - an optional closing photo on the About page.
- Accent-insensitive search ("guayasamin" finds "Guayasamín").
- **CI:** a "Client: lint, typecheck, test, build" job. Render builds the client before starting the API.
- **Docs:** `docs/motion.md` (the full animation map, including later milestones) and ADR 0009 (client stack).
- **Tests:** 14 new server tests (652 total) and 43 client tests. The site was also checked in headless Chrome against both the dev server and the production build: register → submit a commission, the morph, Escape, 3D, phone layout, reduced motion, and no console errors.

### Changed

- **Route changes fade the new page in** instead of crossfading. Keeping the old page mounted during a fade-out made it re-render against the new URL and caused a login redirect loop (see `docs/motion.md`).

## [0.5.0] - 2026-11-21 (Milestone 5a: gallery API, content, and images)

### Added

- **Gallery API:**
  - Public `GET /artworks` with pagination, category and tag filters, and full-text search ranked by relevance; `/artworks/:slug`, `/artworks/categories`, `/tags`.
  - Drafts are never returned publicly, and answer exactly like missing artworks.
- **Admin API** under `/api/v1/admin` (one router-level admin guard): artworks list (with drafts) / get / create / update / delete, and tags list / create / rename / delete.
- **About:** `GET /about` from `content/about.json` (photo, alt text, bio; placeholder text flagged).
- **`npm run media`:** turns originals in the gitignored `media-source/` into a 600px and a 2000px WebP per image in `media/`, plus `manifest.json`.
  - Auto-rotates, converts to sRGB, and **strips all metadata, including GPS**.
  - Content-hashed file names; unchanged originals are skipped.
  - HEIC is decoded through macOS `sips`.
- **`content/artworks.json`:** the owner-edited source of truth, with a strict schema. New photos get an unpublished "to fill in" entry. It holds 7 described artworks and 30 drafts.
- **Content seed:**
  - Syncs the file into the database by per-row hash. A changed entry overwrites; an unchanged one keeps admin edits; a removed one is deleted.
  - Refuses to change anything, failing the deploy, if content and images disagree.
- `/media/artworks` and `/media/about` are served with year-long `immutable` caching, before sessions. The manifest is not exposed.
- **Migration:** image paths and sizes, `alt_text` (required once published), `year`, `credit`, `content_hash`, and a weighted, generated `search_vector` with a GIN index.
- **TypeScript:**
  - Node runs `.ts` directly (type stripping); `npm run typecheck` runs in CI.
  - The state machine, pricing engine, `AppError`, and `withTransaction` were converted.
  - Shared API types are in `shared/types/` (`Artwork`, `AdminArtwork`, `Tag`, `AboutContent`, response envelopes), checked with `satisfies`.
- **CI:**
  - a type-check step;
  - a step that seeds the real content and boots the server under plain Node, as Render does;
  - a test that validates the real `content/` and `media/`.
- ADR 0007 (content files and media pipeline), ADR 0008 (TypeScript via type stripping), and `docs/typescript-guide.md` (with four conversions left for the owner).
- 128 new tests (634 total), including:
  - a test proving GPS/EXIF data is removed;
  - the seed's sync rules;
  - admin auth on every admin route;
  - search edge cases.

### Changed

- `render.yaml` no longer sets `rootDir`. Render hides files outside it, and the server reads `content/` and `media/` at the repo root. Build and start commands now `cd server`.
- `artworks.image_url` was replaced by processed image paths.

## [0.4.0] - 2026-11-20 (Milestone 4: commission state machine and pricing engine)

### Added

- **State machine** (`commissions.stateMachine.js`): the approved transition table as data, covering actors (client, admin, system), guards (revision limit, digital vs. physical), effects (revision count), and dedicated flows (`via: 'quote' | 'refund'`). It provides `canTransition`, `assertTransition` (409 / 403 / 422), and `availableTransitions`.
- **Commission endpoints:** create (client only; size + medium must be priced; price fields ignored), list (own for clients, all for admins, status filter, pagination), detail with available actions, status changes, and event history.
- **`applyTransition`:** row lock (`FOR UPDATE`), state-machine check, update, and event insert in one transaction. It can join a caller's transaction (the quote flow, and the Stripe webhook in milestone 7).
- **Pricing engine** (`pricing.engine.js`): a pure `calculateQuote` returning itemized line items in integer cents. Missing or ambiguous rules are refused (422), never silently $0.
- **Quotes module:** generate a draft (inquiry only; regenerating supersedes the old draft), admin adjustment with a required note, and send. Sending stores total, deposit, and balance and moves the commission to `quoted` in one transaction. Clients never see drafts.
- `lib/money.js`: integer-cent helpers, half-up percentages, and a deposit split that always adds up to the total.
- Required settings `DEPOSIT_PERCENT` and `COMMISSION_REVISION_LIMIT`, with no defaults in code.
- Placeholder price seed, inserted only into an empty pricing table.
- 100% coverage thresholds for the state machine, the pricing engine, and money helpers (CI fails below them), plus global thresholds.
- `docs/state-machine.md` (diagram, table, error codes) and a request-flow sequence diagram in `docs/architecture.md`.
- 365 new tests (506 total): every one of the 144 status pairs × 3 actor types, every pricing combination, concurrency, rollback, and schema-consistency checks.

### Fixed

- The startup config check no longer hides a missing `DATABASE_URL` when another variable is absent.

## [0.3.1] - 2026-11-20 (Milestone 3: first deploy)

### Deployed

- The API is live at https://marigold-and-ink-api.onrender.com (Render free plan), with Postgres 17 on Neon. Verified in production: health check with database ping, security headers, HTTP-to-HTTPS redirect, error shapes, login rate limiting, and the CSRF origin check.

### Changed

- The production database moved from Render Postgres to Neon Free (ADR 0006). Render allows one free database per workspace, and its free tier expires after 30 days. `render.yaml` no longer declares a database; `DATABASE_URL` is entered in the Render Dashboard.

### Added

- `db/connection.js`: a shared pg connection config for the pool and the migration runner. It honors `channel_binding=require` from the connection string, which pg otherwise ignores. TLS verification comes from `sslmode=verify-full`.

## [0.3.0] - 2026-11-17 (Milestone 3: authentication, CI, deploy config)

### Added

- Auth endpoints: `POST /auth/register`, `/auth/login`, `/auth/logout`. Users endpoints: `GET /users/me`, `GET /users/:id` (owner or admin), and admin-only `GET /users` (paginated).
- Server-side sessions in Postgres (express-session + connect-pg-simple) via a new `sessions` migration. The cookie is `httpOnly`, `SameSite=Lax`, with `Secure` and the `__Host-` prefix in production. Sessions roll over 7 days, and the session ID is regenerated on login.
- `requireAuth` (re-reads the user on every request), `requireRole`, `requireOwnerOrAdmin`, and a pure `canAccessOwnedResource` rule.
- bcrypt password hashing (cost 12). Password policy: 12+ characters, at most 72 bytes. Logins take the same time and give the same `INVALID_CREDENTIALS` response for an unknown email or a wrong password.
- Rate limits: 10 failed logins per IP + email per 15 minutes; 5 registrations per IP per hour (configurable).
- CSRF origin check: state-changing requests from an `Origin` outside `CORS_ORIGINS` get `403 CSRF_ORIGIN_MISMATCH`.
- `validate()` middleware (zod, results on `req.validated`), pagination helpers, and duplicate-email translation to `409 EMAIL_TAKEN`.
- Idempotent admin seed (`npm run seed`) from `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
- GitHub Actions CI: lint, format check, migrations, and tests with coverage against a Postgres 17 service container. `main` now requires a PR and this check.
- Render Blueprint (`render.yaml`): web service and Postgres 17. It deploys only after CI passes, and runs migrations and the seed on start.
- ADR 0004 (sessions in Postgres) and ADR 0005 (Render).
- 60 new tests: 141 in total.

### Changed

- `pg` now parses `bigint` columns as JavaScript numbers instead of strings.
- New optional environment variables: `TRUST_PROXY`, `BCRYPT_ROUNDS`, `SESSION_MAX_AGE_DAYS`, and `RATE_LIMIT_*`. `ADMIN_EMAIL` and `ADMIN_PASSWORD` are used by the seed.

## [0.2.0] - 2026-11-17 (Milestone 2: database schema)

### Added

- `node-pg-migrate` with plain SQL migrations, a `migrator.js` library (used by tests), and `migrate:up`, `migrate:down [n|all]`, and `migrate:create` scripts.
- Seven migrations: users; artworks, tags, artwork_tags; pricing_rules; commissions, commission_events, quotes; payments, processed_webhook_events; files, messages; charities, donations.
- Shared `set_updated_at()` trigger, the `commission_status` and `fulfillment_type` domains, `citext` emails, and an append-only trigger on `commission_events`.
- Database-level money invariants: deposit plus balance equals total, positive payment amounts, one successful payment per stage, unique Stripe IDs, one donation per payment, one active charity, and one current quote per commission.
- `docs/data-model.md`: Mermaid ER diagram and an explanation of every constraint and index. It was verified against the live schema (14 tables, 98 columns).
- ADR 0003: migration tool and schema conventions.
- Test factories (`tests/factories/`). The test database is migrated automatically before each run.
- 42 new tests: migrations up, down, and step-by-step redo with no leftover objects; every key constraint rejects bad data.

## [0.1.0] - 2026-11-17 (Milestone 1: server foundation)

### Added

- Docker Compose: dev Postgres 17 (host port 5434), test Postgres 17 (5433), and Redis 7, each with health checks and named volumes.
- `server/` package (ES modules, Node 26) with `dev`, `start`, `test`, `test:watch`, `test:coverage`, `lint`, `format`, and `format:check` scripts.
- `config/env.js`: zod-validated environment. The app refuses to boot and lists every invalid variable.
- Structured logging with pino. Every log line written during a request carries its request ID, via AsyncLocalStorage, including lines from services. Passwords and auth headers are redacted.
- `X-Request-Id` middleware (reuses a safe incoming ID or generates a UUID) and one log line per request with status and duration.
- `AppError` hierarchy (400, 401, 403, 404, 409, 422, 429, 503) and a central error handler that produces `{ error: { code, message, details } }` and never leaks internal messages or stack traces.
- 404 handler (`ROUTE_NOT_FOUND`), 100 KB JSON body limit, helmet, and a CORS allow-list.
- `db/pool.js` (a single pg pool) and `withTransaction()` (commit on success, rollback on error, client always released).
- `GET /api/v1/health` with a database ping (200, or 503 when the database is down).
- `app.js` / `server.js` split, with graceful shutdown on SIGTERM and SIGINT.
- ESLint (flat config) and Prettier. Vitest with a global setup that refuses non-`_test` databases, plus a table-truncation helper.
- 38 tests: config validation, logger and request ID, error handler, 404, `withTransaction` commit and rollback, and the health endpoint.

### Changed

- `.env.example`: `AUTH_SECRET` is now required, `LOG_LEVEL` was added, and the dev database moved to port 5434.

## [0.0.0] - 2026-11-17 (Milestone 0: scaffolding)

### Added

- GitHub repository, MIT license, and `main` branch.
- Root config: `.gitignore`, `.editorconfig`, `.nvmrc` (Node 26.13.1), `.env.example`.
- README skeleton, `CLAUDE.md`, and this changelog.
- Docs: `backlog.md`, `architecture.md` with a layer diagram, ADR 0001 (record decisions), and ADR 0002 (ES modules and Vitest).
- Empty folder tree for `server/` and `client/`.
- Pull request template.

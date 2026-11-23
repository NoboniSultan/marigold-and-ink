# Setting up Stripe payments (test mode)

The site takes the commission deposit and the final balance through **Stripe Checkout**: the client clicks "Pay deposit" and pays on Stripe's own secure page, so card details never touch this app. Stripe then tells the app what happened through a **webhook** (a signed message to `POST /api/v1/webhooks/stripe`).

Everything here is **test mode**: no real money moves, and the app refuses live keys (`sk_live_…`) by design.

## 1. A Stripe account and its test key

1. Create a free account at <https://dashboard.stripe.com/register>. You don't need to activate payments or add bank details for test mode.
2. Make sure **Test mode** is on (the toggle at the top of the Dashboard).
3. Go to **Developers → API keys** and copy the **Secret key** (`sk_test_…`). Keep it secret: it goes only in `.env` (and later the Render Dashboard), never in a commit or a chat.

## 2. The Stripe CLI (for local testing)

Stripe can't reach `localhost`, so the Stripe CLI receives the webhooks and forwards them to your machine.

```sh
brew install stripe/stripe-cli/stripe
stripe login          # opens the browser once to connect the CLI to your account
```

## 3. Configure `.env`

In the repo's `.env` (gitignored), set:

```
STRIPE_SECRET_KEY=sk_test_...          # from step 1
STRIPE_WEBHOOK_SECRET=whsec_...        # from step 4 below
PAYMENT_CURRENCY=usd
PUBLIC_URL=http://localhost:5173       # where Stripe sends the client back
```

`PUBLIC_URL` is the address in the browser's address bar (the Vite site), not the API's port.

## 4. Run everything (three terminals)

First, bring your dev database up to date. Payments added new columns, and without them the commission page says "Your payments couldn't load" (the API answers 500). Run this once after pulling, from the repo folder with Docker running:

```sh
cd server && npm run migrate:up
```

It prints the migrations it applied, or none if you're already up to date. (The tests use the separate test database, which migrates itself, so they pass either way.)

```sh
# Terminal 1: forward Stripe's webhooks straight to the API (port 3000)
stripe listen \
  --events checkout.session.completed,checkout.session.expired,refund.created,refund.updated,refund.failed \
  --forward-to localhost:3000/api/v1/webhooks/stripe
```

`--events` lists the five events the app handles (the same ones as the Render endpoint in step 6). Recent Stripe CLI versions refuse to start without it ("must specify events to forward").

It prints `Your webhook signing secret is whsec_…`. Put that in `.env` as `STRIPE_WEBHOOK_SECRET` (it stays the same between runs), then start or restart the API, which reads `.env` only at startup. Keep this terminal open.

```sh
# Terminal 2: the API          # Terminal 3: the site
cd server && npm run dev       cd client && npm run dev
```

## 5. A test deposit, start to finish

1. **Open the site** (<http://localhost:5173>), sign up as a client (with the default `EMAIL_TRANSPORT=log`, the 6-digit code prints in terminal 2), and **request a commission**. Note its number (Request #…).
2. **Send it a quote as the admin.** There's no admin screen yet, so use the API. In a fourth terminal, from the repo folder (the commands read your admin email from `.env`), replacing `12` with your request number:

   ```sh
   read -s "ADMIN_PASSWORD?Admin password: " && echo
   ORIGIN=http://localhost:5173
   curl -s -c /tmp/admin-cookie -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
     -d "{\"email\":\"$(grep ^ADMIN_EMAIL= .env | cut -d= -f2)\",\"password\":\"$ADMIN_PASSWORD\"}" \
     localhost:3000/api/v1/auth/login > /dev/null
   curl -s -b /tmp/admin-cookie -H "Origin: $ORIGIN" -X POST localhost:3000/api/v1/commissions/12/quote
   curl -s -b /tmp/admin-cookie -H "Origin: $ORIGIN" -X POST localhost:3000/api/v1/commissions/12/quote/send
   ```

   (The first line asks for the password without echoing it.) The last command answers with `"status":"quoted"` and the deposit amount.
3. **Pay.** Back in the browser, open the request (`/commissions/12`) and click **Pay deposit**. On Stripe's page use the test card **4242 4242 4242 4242**, any future expiry date, any CVC, any postcode.
4. **Check the result.** Stripe sends you back to the request, which says *"Thank you, your payment went through"* and *"Deposit paid"*. Terminal 1 shows `checkout.session.completed` with `[200]`.
5. **Optional: a replay changes nothing.** Copy the event ID (`evt_…`) from terminal 1, then run `stripe events resend evt_…`. The app answers `"duplicate": true`, and the request's status and payments stay the same.
6. **Optional: a refund.**

   ```sh
   curl -s -b /tmp/admin-cookie localhost:3000/api/v1/commissions/12/payments   # note the deposit's "id"
   curl -s -b /tmp/admin-cookie -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
     -d '{"paymentId": 1, "reason": "Testing a refund"}' \
     localhost:3000/api/v1/admin/commissions/12/refunds
   ```

   A full refund moves the request to *Refunded*. Leave out `amountCents` for a full refund, or set it for a partial one.

Afterwards, `rm /tmp/admin-cookie`. The test account and request stay in your dev database until you delete them.

**Other test cards:** `4000 0000 0000 9995` is declined (insufficient funds); `4000 0027 6000 3184` asks for 3-D Secure authentication. See <https://docs.stripe.com/testing>.

## 6. On Render (later, when you want it live in test mode)

1. In the Stripe Dashboard (test mode), go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://noboni.art/api/v1/webhooks/stripe` (the old onrender.com address keeps working too: the webhook is never redirected)
   - Events: `checkout.session.completed`, `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed`
2. Copy that endpoint's **signing secret** (`whsec_…`; it differs from the CLI's).
3. In the Render Dashboard → the service → **Environment**, add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. (`PAYMENT_CURRENCY` and `PUBLIC_URL` are already in `render.yaml`.) Render redeploys, and the "Pay" buttons appear.

Until both secrets are set, payments stay off: the site says "Online payment opens soon", and the payment endpoints answer 503 `PAYMENTS_UNAVAILABLE`.

## How it works

See [ADR 0011](decisions/0011-stripe-payments.md) for the design: amounts come from the stored quote, every Stripe call has an idempotency key, each webhook is handled once in a single transaction, and a payment that arrives for a cancelled commission is refunded automatically.

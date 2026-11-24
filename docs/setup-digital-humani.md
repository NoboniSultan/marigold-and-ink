# Setting up giving (trees through Digital Humani)

When a commission is **fully paid**, 25% of its full price is turned into trees ($1 each, rounded up) and requested from [Digital Humani](https://digitalhumani.com), a nonprofit that passes the request to a planting partner. The site does this automatically; you never send anything by hand.

**What isn't automatic:** paying for the trees. The planting partner emails you an **invoice** (monthly or quarterly, often once 20–50 trees have built up), and you pay it. Digital Humani itself charges nothing. Requests can't be cancelled, which is why the site never refunds the tree money (see "Refunds" below).

Giving stays **off** until it's configured, and it needs payments (Stripe) switched on.

## 1. Create a Digital Humani account, then open its Sandbox

1. Register at <https://my.digitalhumani.com/register>. It's free and self-serve.
2. **Open the Sandbox dashboard at <https://my.sandbox.digitalhumani.com>.** It's a separate site, not a switch in the normal dashboard, so you won't find a "test mode" toggle there. Sign in with the **same email and password** you registered with: every account gets both environments ([Digital Humani docs](https://docs.digitalhumani.com/), "Sandbox Environment"). Sandbox requests are free and plant nothing: the right place while Stripe is in test mode. (The app refuses `production` until payments are live, so test payments can never order real trees.)
3. In the **Sandbox** dashboard, open the **Developer** page and copy the **API key** and your **enterprise ID** (8 digits). The sandbox and production API keys are different, so take them from the sandbox site.

## 2. Choose the planting project

Digital Humani's docs list every project (<https://docs.digitalhumani.com/>, "Appendix 1: List of projects"); the same IDs work in Sandbox and Production. One Tree Planted has one per region (Africa, Asia, Canada, Europe, Latin America, North America, the United States, Mangroves) and one for **"where the trees are needed the most"**. Copy the ID of the one you want from that table. Check that it's still **active** there (or under the dashboard's projects): only active projects take requests.

## 3. Configure the app

**Locally**, in `.env`:

```
DIGITALHUMANI_API_KEY=...            # sandbox key, from step 1
DIGITALHUMANI_ENTERPRISE_ID=...      # from step 1
DIGITALHUMANI_PROJECT_ID=...         # from step 2
DIGITALHUMANI_ENVIRONMENT=sandbox
DONATION_PERCENT=25
```

Restart `npm run dev` in `server/`.

**On Render:** Dashboard → the service → **Environment**. Add `DIGITALHUMANI_API_KEY`, `DIGITALHUMANI_ENTERPRISE_ID`, and `DIGITALHUMANI_PROJECT_ID`. (`DIGITALHUMANI_ENVIRONMENT=sandbox` and `DONATION_PERCENT=25` are already in `render.yaml`.) Render redeploys.

## 4. Check it

Pay a commission in full with Stripe's test card (the deposit, then the balance; see `docs/setup-stripe.md`). Then:
- the server log says `trees requested through Digital Humani`;
- the **Giving** page (`/giving`) counts the trees;
- the sandbox dashboard shows the request, under the reference `commission-<number>`.

Digital Humani only ever receives that reference, never a client's name or email.

## Refunds

Once a commission is fully paid, its trees are on order and can't be cancelled, so **the tree money is never refunded**. A full refund through the site gives back everything except the trees' cost (for a $110 commission: 28 trees, so up to $82). Refunds before the final payment aren't affected, because no trees exist yet.

**Refund only through the site** (the admin refund endpoint). A refund made directly in the Stripe Dashboard skips this check, and could give back money that already went to trees.

## If something goes wrong

If Digital Humani can't be reached, the payment still goes through. The trees stay **pending** and are retried after the next payment and whenever the server restarts. If an answer was lost, the retry first asks Digital Humani how many trees it already has under that commission's reference and orders only what's missing, so trees are never ordered twice.

## Going live

When Stripe goes live (real payments), switch Digital Humani too: production API key, `DIGITALHUMANI_ENVIRONMENT=production`, and remove the check that refuses it in `server/src/config/env.js`. Then real trees are ordered and invoiced to you. See [ADR 0013](decisions/0013-giving-through-digital-humani.md).

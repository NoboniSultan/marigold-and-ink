# Setting up giving (trees through Digital Humani)

When a commission is **fully paid**, 25% of its full price is turned into trees ($1 each, rounded up) and requested from [Digital Humani](https://digitalhumani.com), a nonprofit that passes the request to a planting partner. The site does this automatically; you never send anything by hand.

**What isn't automatic:** paying for the trees. The planting partner emails you an **invoice** (monthly or quarterly, often once 20–50 trees have built up), and you pay it. Digital Humani itself charges nothing. Requests can't be cancelled, which is why the site never refunds the tree money (see "Refunds" below).

Giving stays **off** until it's configured, and it needs payments (Stripe) switched on.

## 1. Create a Digital Humani account

1. Register at <https://my.digitalhumani.com/register>. It's free and self-serve.
2. Switch the dashboard to **Sandbox**. Sandbox requests are free and plant nothing: the right mode while Stripe is in test mode. (The app refuses `production` until payments are live, so test payments can never order real trees.)
3. Open the **Developer** page and copy the **API key** and your **enterprise ID**. The sandbox and production keys are different.

## 2. Choose the planting project

Digital Humani lists its projects in its docs (<https://docs.digitalhumani.com>, "List of projects"), including several **One Tree Planted** projects. Copy the project ID of the one you want. (There's also a "where it's needed most" option.)

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

If Digital Humani can't be reached, the payment still goes through. The trees stay **pending** and are retried after the next payment and whenever the server restarts. If an answer was lost, the retry first asks Digital Humani what it already has under that commission's reference, so trees are never ordered twice.

## Going live

When Stripe goes live (real payments), switch Digital Humani too: production API key, `DIGITALHUMANI_ENVIRONMENT=production`, and remove the check that refuses it in `server/src/config/env.js`. Then real trees are ordered and invoiced to you. See [ADR 0013](decisions/0013-giving-through-digital-humani.md).

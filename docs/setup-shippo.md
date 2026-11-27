# Setting up shipping (Shippo)

Shipping for physical commissions uses **Shippo** ([ADR 0017](decisions/0017-us-shipping-with-shippo.md), [ADR 0018](decisions/0018-shipping-labels-and-tracking.md)). It checks the client's address, prices USPS postage live, and (from milestone 11b) buys labels and tracks packages. Until it's set up, physical commissions can't take their final payment, and the pages say shipping opens soon. Digital and mixed-media work isn't affected.

**Cost:** a Shippo account is free. The API plan includes 30 labels a month, then a few cents per label; postage itself is charged when a label is bought, and the client has already paid it with the balance. Test mode costs nothing. Check the current prices at <https://goshippo.com/pricing/api>.

## 1. Create a Shippo account and a test token

1. Sign up at <https://apps.goshippo.com/join>.
2. Open **Settings → Advanced → API** (or **API** in the left menu).
3. Under **Test token**, generate one and copy it. It starts with `shippo_test_`.
   - The site refuses a `shippo_live_` token while payments are in test mode: a live token buys real postage.

## 2. Decide the packaging fee and the return address

- **Packaging fee:** added to every shipment's postage, in cents (`400` = $4.00, `0` for none). It's shown to the client as part of "Shipping & packaging".
- **Return address:** printed on every label, so every client sees it. A PO Box works with USPS. It's kept only in `.env` and Render, never in the code (the repository is public).
- **Return email and phone:** USPS requires both to make a label. They go to Shippo and USPS with each label but aren't printed on it (checked on a test label). Prices work without them; buying a label doesn't.

## 3. Configure the app

**Locally**, in `.env`:

```
SHIPPO_API_KEY=shippo_test_...
PACKAGING_FEE_CENTS=400
SHIP_FROM_NAME=Marigold & Ink
SHIP_FROM_STREET1=...
SHIP_FROM_STREET2=
SHIP_FROM_CITY=...
SHIP_FROM_STATE=NY
SHIP_FROM_ZIP=10001
SHIP_FROM_EMAIL=...
SHIP_FROM_PHONE=...
SHIPPO_WEBHOOK_TOKEN=...
```

`SHIP_FROM_STREET2` (a unit or suite) can stay empty. `SHIP_FROM_STATE` is two capital letters. `SHIP_FROM_PHONE` is 10 digits, with or without dashes (`212-555-0100`). Keep comments on their own lines, never after a value.

`SHIPPO_WEBHOOK_TOKEN` is the secret part of the tracking link Shippo calls (step 5). Make one with `openssl rand -hex 32` in a terminal. Use a different one locally and on Render. Without it, tracking is still checked once a day.

Restart `npm run dev` in `server/`. If a value is the wrong shape, the server won't start and says which one.

**On Render:** Dashboard → the service → **Environment**: add the same settings. Render redeploys.

## 4. Check it

1. Make a test commission with **Physical** delivery and take it to **Deposit paid** (Stripe test card `4242 4242 4242 4242`).
2. As the client, the commission's page shows **Shipping**: enter an address. Shippo test mode checks it; the saved address comes back in the carrier's capitals.
3. As the admin, on the commission's page, **Shipping → Package**: enter the packed weight (ounces) and size (inches).
4. Move the commission to **Awaiting final payment**. As the client, **See shipping options**, choose one, and **Pay balance and shipping**. Stripe's page shows two lines: the balance, and "Shipping & packaging".
5. After paying, the commission is **Ready to ship**, and the monthly report shows the shipping part under "Of which shipping".
6. As the admin, **Shipping → Get label prices**. The client's service is marked, with what they paid and any difference. **Buy label**, then **Print label (PDF)**: a letter-size page with the label in the top half (cut along its border). Test labels say "SAMPLE - DO NOT MAIL".
7. **Void label** refunds it (test mode always accepts). Then you can buy another.
8. Test labels never move, so tracking can't be tried with them. Shippo's test webhook (step 5) checks that the link works.

## 5. Turn on tracking updates (webhook)

Shippo tells the site when a package is scanned. The site then asks Shippo itself, so the message only has to reach it.

1. In Shippo, open **Settings → Webhooks** (<https://portal.goshippo.com/api-config/webhooks>) and **Add webhook**.
2. **Event:** Track Updated. **Mode:** Test while the token is a test one.
3. **URL:** `https://noboni.art/api/v1/webhooks/shippo?token=` followed by your `SHIPPO_WEBHOOK_TOKEN` on Render.
4. Save, then use Shippo's **Test** button. It sends a made-up tracking number, so the site answers `{"data":{"handled":false}}`, which means the link and token work. A wrong token answers 401.

Without a webhook, the site still checks every package on its way once a day (and at each restart), and the admin page has **Check tracking now**.

## If something goes wrong

- **"The shipping service couldn't be reached"**: Shippo was down or the token is wrong. Check the token, then try again.
- **"No shipping options are available"**: the package is too big or heavy for the USPS services offered (Ground Advantage, Priority, Priority Express). Check the package's measurements.
- **"Labels need the return email and phone"**: add `SHIP_FROM_EMAIL` and `SHIP_FROM_PHONE`.
- **"The carrier couldn't make this label"**: the carrier's reasons are listed under it. Check the address and the package.
- **"Those label prices have expired"**: prices can only be bought for a few days. Get the prices again.
- **A leaked token:** delete it in Shippo's API settings and generate a new one.
- **A leaked webhook token:** make a new one, update it on Render, and edit the webhook's URL in Shippo.

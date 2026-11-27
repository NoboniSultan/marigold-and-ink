# Opening the shop

The shop is built (milestones 12a to 12d) but stays closed: only the admin sees it until `SHOP_OPEN=true`. This list covers everything that only the owner can do before opening it. Work through it top to bottom.

## 1. The catalog

- [ ] **Packing types** (Admin → Shop → Packing): each real mailer and box, with its inside size and empty weight.
- [ ] **Products:**
  - a packing type, or "pickup only" for pieces too large to mail;
  - a packed **weight** on every option;
  - photos with alt text.
- [ ] Publish them. A product that ships can't be published without its packing type and weights.

## 2. Wording (yours to write; the site never invents it)

- [ ] `client/src/content/copy.ts`: `shop.intro`, `shop.empty`, and `shop.pickupNote` (all `PLACEHOLDER`).
- [ ] `server/src/modules/orders/orders.emails.ts`: the order confirmation email's subject, opening, and pickup line. In production, an email with a placeholder is never sent, so until this is done customers get no confirmation.
- [ ] Lines that say only commissions plant trees, now that delivered shop orders do too:
  - `copy.ts`: "Every commission plants trees." (home), the footer line "With every commission, 25% goes toward planting trees.", and the Giving page's "25% of every commission".
  - Optional: a line telling customers how many trees their order planted (in the backlog, waiting for your wording).
- [ ] **Terms of service** (`client/src/content/terms.md`) cover commissions only. Add:
  - returns and refunds for shop items, including that the tree money isn't refunded once an order has been delivered;
  - local pickup;
  - shipping for shop orders.

  Also update sections 5D and 6, which tie trees to commissions.
- [ ] **Privacy policy** (`client/src/content/privacy.md`):
  - Digital Humani also receives order references (such as `order-12`);
  - shop orders' shipping addresses go to Shippo and USPS;
  - the cart is kept in the browser (`localStorage`, no personal data);
  - update the "25% of every commission" line.

## 3. Payments and money

- [ ] Stripe Dashboard → Settings → Payment methods → Link: turn off **Bank** and **Klarna** (delayed payments aren't handled; see the backlog).
- [ ] **Sales tax:** the terms say checkout doesn't collect it. Decide how to handle it with a professional before real sales.
- [ ] Stripe stays in **test mode**, so an open shop takes only test cards. Real sales need live Stripe, and with it live Shippo and Digital Humani production (all refused by the config today).

## 4. Shipping and giving

- [ ] Rotate `SHIPPO_WEBHOOK_TOKEN`. The old one was shown in a terminal; update it in Render and in Shippo's webhook link.
- [ ] Confirm `PACKAGING_FEE_CENTS` and `DONATION_PERCENT` in Render. Both are your values; the current ones are placeholders.

## 5. Turn it on

1. Render → the API service → Environment: set `SHOP_OPEN` to `true`. The server refuses to start unless payments (Stripe) and shipping (Shippo) are also set up.
2. Logged out, open `/shop`: the products show, and "Add to cart" asks visitors to log in at checkout.
3. Place a test order end to end: shipping options, Stripe test card, then a label from the admin order page (void it afterwards).

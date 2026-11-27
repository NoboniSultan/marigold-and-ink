# 17. US shipping with Shippo

- **Status:** Accepted
- **Date:** 2026-11-25

## Context

Milestone 11 ships physical commissions. The proposal (section 7) asks for a validated address, live rates from a shipping API, shipping charged before the final payment and not counted toward the donation, labels, tracking, and delivery confirmation. The terms of service say shipping and packaging are separate from the commission price, communicated before the final payment, and United States only.

The owner decided (2026-11-25):
- **Mixed media is delivered as files**, never shipped (the proposal had it ship the original too). Only physical work ships.
- The client chooses the shipping speed from the services offered, **USPS only** to start.
- A flat **packaging fee**, set by the owner, is added to the postage.
- No paid insurance and no signature for now (the carriers' built-in coverage applies).
- The owner enters each package's weight and size.
- After an account is deleted, past shipments keep only the city, state, and ZIP.
- The work is split: **11a** (address, prices, and the final payment) and **11b** (labels, tracking, and emails).

Shippo and EasyPost were compared. Both are free at this volume (Shippo: 30 labels a month, then a few cents each; EasyPost: 3,000). Shippo was chosen because EasyPost is reported to add 3% to USPS postage bought through it (reported by Shippo, not confirmed by EasyPost), has changed its pricing twice in 2026, and Shippo has a dashboard for buying a label by hand.

## Decision

- **One adapter**, `adapters/shippo.ts` (plain `fetch`, no SDK): check an address, price a package (a Shippo "shipment" with one rate per service), and read a rate back by ID. Tests pass a fake (`tests/helpers/shipping.ts`).
- **Settings:** `SHIPPO_API_KEY`, `PACKAGING_FEE_CENTS` (no default), and the return address (`SHIP_FROM_*`, in `.env` and Render only, since the repo is public) switch shipping on together. A `shippo_live_` token is refused while Stripe is test-only, for the same reason as Digital Humani production: real postage, paid by the owner, with no real income behind it.
- **One `shipments` row per commission:** the address (standardized by the carrier), the package, the Shippo shipment the current prices belong to, and the chosen option (carrier, service, postage, packaging fee).
- **When:** the address and package can be set from the deposit until the final payment. Prices are fetched and an option chosen only while the final payment is due, so prices are current. Changing the address or package forgets the prices and the choice.
- **Prices come from Shippo, never the browser.** Choosing sends only a rate ID; the server reads that rate from Shippo and checks it belongs to the latest quote. At checkout the rate is read again, and if the postage changed the client is asked to choose again.
- **The final payment** of a physical commission is the balance plus shipping: two lines on Stripe's page, one payment row with `shipping_cents` recording the shipping part. The donation stays based on the quoted price (unchanged). If the client changes the option while a payment page is open, that page is closed on Stripe before a new one opens, so the old amount can't be paid.
- **Without shipping configured**, a physical commission can't take its final payment (503 `SHIPPING_UNAVAILABLE`), rather than charging the balance without shipping.
- **Mixed media** now goes from the final payment straight to `delivered`, like digital work (state machine change).
- The monthly report shows the shipping part of sales on its own.

## Consequences

- Clients see the exact shipping cost before paying, and the owner never undercharges by typing a price.
- Shipping depends on Shippo at three moments (address, prices, checkout). If it's down, those steps answer 502 and can be retried; nothing is recorded half-way.
- The owner pays for postage when buying the label (11b), after the client has paid. A label bought later could cost a little more than quoted; the owner absorbs the difference.
- No address book yet: each commission has its own address. A saved address can come with the shop.
- In 11b: labels from the admin page, tracking updates (a webhook that the server confirms by asking Shippo), the `shipped`/`delivered` changes by the system, and the shipped and delivered emails.

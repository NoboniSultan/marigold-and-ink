# Setting up file storage (Cloudflare R2)

Reference photos, previews, and final files are kept in a **private Cloudflare R2 bucket** ([ADR 0016](decisions/0016-commission-files-on-r2.md)). Until it's set up, uploads stay off and the pages don't offer them.

**Before you switch it on in production:** add a short part to the privacy policy (`client/src/content/privacy.md`) about reference photos: that clients may upload them, that location and camera details are removed, that they're stored with Cloudflare R2 (United States), and that they're deleted 90 days after the commission ends (or when the account is deleted). Final files and previews are kept a year after full payment.

**Cost:** R2's free tier covers 10 GB of storage and has no download fees at all; this shop's files are expected to stay well under that. Cloudflare may still ask for a card to switch R2 on.

## 1. Switch on R2 and create the bucket

1. Sign in (or sign up) at <https://dash.cloudflare.com>.
2. Open **R2 Object Storage**. If asked, add a payment method and confirm the R2 plan (the free tier applies).
3. **Create bucket**: name it `marigold-files`. Leave the location on automatic (or pick Eastern North America) and the storage class on **Standard**.
4. Leave **public access off** (the default). The site only ever hands out short-lived signed links; nothing in the bucket is public.

## 2. Create an access key for this bucket only

1. In R2, open **Manage API tokens** (or **API → Manage API tokens**) → **Create API token**.
2. **Permissions:** Object Read & Write. **Specify bucket:** `marigold-files` only. Leave the expiry as you like (no expiry is fine).
3. **Create**, then copy the **Access Key ID** and **Secret Access Key**. The secret is shown **once**; paste it straight into `.env` / Render, nowhere else.
4. Copy your **Account ID** (32 characters) from the R2 overview page.

## 3. Configure the app

**Locally**, in `.env`:

```
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=marigold-files
```

Restart `npm run dev` in `server/`.

**On Render:** Dashboard → the service → **Environment**: add the same four. Render redeploys.

## 4. Check it

1. As a client, open a commission that's still an inquiry and **Add reference photos**. The photo appears; in the R2 bucket, a file appears under `commissions/<number>/reference/`.
2. As the admin, on a commission past its deposit, **Add previews**: the client's page shows it with the watermark.
3. Add a **final file**; it shows on the client's page once the commission is paid in full.

## Keeping costs down

- Uploads are limited (10 photos of 15 MB per commission, previews 25 MB, finals 100 MB, 60 uploads an hour per person), photos are shrunk before they're stored, and old files are deleted automatically.
- The token can only touch this one bucket, so a leaked key can't be used for anything else at Cloudflare. If you ever think it leaked, delete it in **Manage API tokens** and create a new one.
- Cloudflare's dashboard shows R2 usage under **R2 → Overview**; glance at it now and then.

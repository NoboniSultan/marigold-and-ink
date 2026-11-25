# Setting up file storage (Cloudflare R2)

Reference photos, previews, and final files are kept in a **private Cloudflare R2 bucket** ([ADR 0016](decisions/0016-commission-files-on-r2.md)). Until it's set up, uploads stay off and the pages don't offer them.

The privacy policy (section 1E) already describes reference photos, the files' keeping periods, and that they are stored with Cloudflare R2 **in the United States**, so the bucket must be placed there (step 1).

**Cost:** R2's free tier covers 10 GB of storage and has no download fees at all; this shop's files are expected to stay well under that. Cloudflare may still ask for a card to switch R2 on.

## 1. Switch on R2 and create the bucket

1. Sign in (or sign up) at <https://dash.cloudflare.com>.
2. Open **R2 Object Storage**. If asked, add a payment method and confirm the R2 plan (the free tier applies).
3. **Create bucket**: name it `marigold-files`. Under **Location**, choose **Provide a location hint** → **Eastern North America (ENAM)** (not Automatic, which could pick another region; the privacy policy says the files are in the United States). Leave the storage class on **Standard**.
4. Open the new bucket's **Settings** and check that its location shows **ENAM**. A location hint is a strong preference, not a guarantee; if it shows anything else, delete the empty bucket and try again.
5. Leave **public access off** (the default). The site only ever hands out short-lived signed links; nothing in the bucket is public.

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

## 5. A separate bucket for local development

Your computer and the live site should not share a bucket. Commission numbers overlap between the dev and production databases. File names are unique, so nothing is overwritten, but test files would sit beside real client files, and the live site's clean-up never removes them because its database doesn't know them.

1. In R2, **Create bucket** `marigold-files-dev`, with the same settings as step 1 (Eastern North America, Standard, public access off).
2. **Create API token** as in step 2, limited to `marigold-files-dev` only.
3. In your local `.env` only, set `R2_BUCKET=marigold-files-dev` and replace `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` with the new key's values. `R2_ACCOUNT_ID` stays the same. Restart `npm run dev`.
4. Render keeps `marigold-files` and the production key. Never put the production key in `.env`.

Test files left in the dev bucket can be emptied any time from the bucket's page in Cloudflare.

## Keeping costs down

- Uploads are limited (10 photos of 15 MB per commission, previews 25 MB, finals 100 MB, 60 uploads an hour per person), photos are shrunk before they're stored, and old files are deleted automatically.
- The token can only touch this one bucket, so a leaked key can't be used for anything else at Cloudflare. If you ever think it leaked, delete it in **Manage API tokens** and create a new one.
- Cloudflare's dashboard shows R2 usage under **R2 → Overview**; glance at it now and then.

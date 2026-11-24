# Setting up Google sign-in and sign-up emails

Both features are **off until configured**, and the site works without them:
- **Without Google settings,** the "Continue with Google" button is hidden.
- **Without email settings in production,** email sign-up says "opens soon". In development, codes are printed in the server terminal.

Secrets go only in `.env` (local) and the Render Dashboard (production), never in git.

## Google sign-in

You need a free Google Cloud project. The console's labels change from time to time; the steps below describe what each part does, in case the wording differs.

1. **Create a project.** Go to <https://console.cloud.google.com/>, create a project (e.g. "Marigold & Ink"), and select it.
2. **Set up the consent screen.** Open **Google Auth Platform** (it may also appear as "APIs & Services → OAuth consent screen").
   - **App information:** the app name visitors will see ("Marigold & Ink") and your support email.
   - **Audience:** **External**, so customers can sign in, not just your organization.
   - **Contact information:** your email.
   - **Data access (scopes):** add only `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile`. These are "non-sensitive" scopes, so Google doesn't need to review the app.
3. **Choose who can sign in.**
   - A new app starts in **Testing**: only the Google accounts you add as **test users** can sign in. Add your own Gmail to try it.
   - When you're ready for customers, choose **Publish app** ("In production"). With only the three basic scopes, publishing doesn't need Google's review.
4. **Create the OAuth client.** Under **Clients** (or "Credentials → Create credentials → OAuth client ID"):
   - Application type: **Web application**.
   - **Authorized redirect URIs:** add both, exactly:
     - `http://localhost:5173/api/v1/auth/google/callback` (development, through Vite)
     - `https://noboni.art/api/v1/auth/google/callback` (production)
   - Authorized JavaScript origins: none needed. The server does the whole exchange.
5. **Copy the client ID and client secret.**
   - **Locally,** in `.env`:
     ```
     PUBLIC_URL=http://localhost:5173
     GOOGLE_CLIENT_ID=....apps.googleusercontent.com
     GOOGLE_CLIENT_SECRET=...
     ```
     Restart `npm run dev` in `server/`.
   - **On Render:** Dashboard → the service → **Environment**. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. (`PUBLIC_URL` is already set in `render.yaml`.) Render redeploys automatically.

`PUBLIC_URL` must be the address **in the browser's address bar**, so `http://localhost:5173` locally, not the API's port 3000. Google sends the visitor back there, and the session cookie belongs to that address.

**The production address is the custom domain, `https://noboni.art`** (see "Changing the site's domain" below). Google only accepts sign-in returns to an address listed under **Authorized redirect URIs**, so that list must match `PUBLIC_URL`.

### Publishing the app

Before anyone outside your test users can sign in, Google needs a public homepage and privacy policy. In Google Auth Platform → **Branding**:
- **Application home page:** `https://noboni.art`
- **Application privacy policy link:** `https://noboni.art/privacy` (its text lives in `client/src/content/copy.ts`; write it before publishing)
- **Authorized domains:** `noboni.art`. Google may ask you to prove you own it through Google Search Console, which means adding one TXT record at your registrar.

Then **Audience → Publish app**. With only the three basic scopes, Google doesn't need to review the app.

### Changing the site's domain

The site answers page requests on one address only, `PUBLIC_URL`. In production, any other address (the onrender.com one, `www.`) redirects there, except the Stripe webhook and the health check. To move to a new domain:
1. Render → the service → **Settings → Custom Domains**: add it, create the DNS records Render shows at your registrar, and wait for the HTTPS certificate.
2. Render → **Environment**: add the new origin to `CORS_ORIGINS` (comma-separated, one variable), keeping the old one.
3. Google → **Clients**: add the new callback URL to the redirect URIs (keep the old one until the switch is live).
4. Change `PUBLIC_URL` in `render.yaml` through a PR, and merge it.
5. Google → **Branding**: update the homepage, privacy link, and authorized domain. Stripe → the webhook endpoint: update its URL (the signing secret stays the same).

### How it behaves

| Situation | What happens |
| --- | --- |
| New visitor | A client account is created, already verified, with no password. |
| Returning visitor | Matched by Google's permanent account ID (not email), so changing their Gmail address doesn't create a new account. |
| Same email as an existing verified account | Google is linked to it; the password still works too. |
| Same email as an old, unverified account | Google is linked, the old password is removed, and other sessions are signed out. Someone else might have set that password (see [ADR 0010](decisions/0010-email-verification-and-google-sign-in.md)). |
| Admin account | Google sign-in is refused; the admin uses the password. |
| Google says the email isn't verified | Refused. |

## Sign-up emails (Resend)

Sign-up sends a 6-digit code by email through [Resend](https://resend.com) (free up to 3,000 emails a month). Email providers only deliver mail "from" a domain whose owner has proven control of it, so Resend needs a few DNS records on **noboni.art**, which you add at **Hover** (where the domain is registered).

**Which domain to enter: `mail.noboni.art`.** Resend recommends sending from a subdomain rather than the main domain, "to isolate your sending reputation" ([Resend docs](https://resend.com/docs/dashboard/domains/introduction)). It costs nothing extra and changes nothing about the website: noboni.art keeps working exactly as it does. The emails then come **from an address at that subdomain**, `hello@mail.noboni.art` (Resend only sends from the domain you verified).

### 1. Add the domain in Resend

1. Sign up at <https://resend.com> and open **Domains → Add Domain**.
2. **Name:** `mail.noboni.art`. **Region:** North Virginia (`us-east-1`), closest to most of your visitors.
3. Resend opens the domain's **Records** tab: usually an **MX** and a **TXT** record on `send.mail`, and a **TXT** record on `resend._domainkey.mail` (newer domains may get **CNAME** records instead). Whatever it shows is what you add next; keep the tab open.

### 2. Add the records at Hover

In Hover: **Domains → noboni.art → DNS → Add a record**, once for each record in Resend's Records tab:

| In Hover | What to enter |
| --- | --- |
| **Type** | The record's type in Resend (MX, TXT, or CNAME) |
| **Hostname** | The record's name **without** `.noboni.art`: Hover adds the domain itself. So `send.mail.noboni.art` becomes `send.mail`, and `resend._domainkey.mail.noboni.art` becomes `resend._domainkey.mail`. If Resend already shows `send.mail`, type it as is. |
| **Value / Target** | Copy and paste Resend's value exactly (the long DKIM key included). For TXT, leave out any surrounding quotation marks. |
| **Priority** (MX only) | The priority Resend shows (usually `10`) |

None of these touch the website's records (the `A`/`CNAME` records Render uses) or any email you receive. The MX record is on `send.mail.noboni.art` and only collects bounce reports for Resend.

Back in Resend, press **Verify DNS Records**. It's often verified within 15 minutes and can take up to 72 hours. A record that stays red is usually a Hostname typed with `.noboni.art` on the end, or a value cut short when pasting.

**Recommended once verified (helps Gmail and Yahoo trust the mail):** add a DMARC record at Hover: Type **TXT**, Hostname `_dmarc`, Value `v=DMARC1; p=none;`. It only asks receivers to report; it blocks nothing.

### 3. Create an API key

Resend → **API Keys → Create API Key**: name it (e.g. `marigold-render`), **Permission: Sending access**, **Domain: mail.noboni.art**. Copy the key (it starts with `re_`); Resend shows it only once. Don't paste it anywhere but Render (and your own `.env`).

### 4. Configure the app

**On Render** (Dashboard → the service → **Environment**):

```
EMAIL_TRANSPORT=resend
RESEND_API_KEY=re_...                          # from step 3
EMAIL_FROM=Marigold & Ink <hello@mail.noboni.art>
```

`PUBLIC_URL` is also required with `resend` (the email links back to the site); `render.yaml` already sets it to `https://noboni.art`. Render redeploys on save.

**Locally** you can keep the default (`EMAIL_TRANSPORT` unset or `log`: codes print in the server terminal), or put the same three values in `.env` to receive real email while developing.

### 5. Check it

Sign up on <https://noboni.art> with your own email address. The code should arrive within a minute, from "Marigold & Ink" `<hello@mail.noboni.art>` (check spam the first time). If sending fails, the visitor sees "We couldn't send the email" and can retry at once, and the Render log says why (for example, a domain that isn't verified yet). Replies to `hello@mail.noboni.art` aren't received anywhere; the code email doesn't ask for one.

### How sign-up codes work

| Rule | Value |
| --- | --- |
| Code | 6 digits, random, from a cryptographic generator |
| Valid for | 15 minutes |
| Wrong tries allowed | 5; after that the visitor must request a new code |
| Resend | Once a minute; also at most 5 code requests per hour per IP address |
| Storage | Only a keyed hash (HMAC-SHA256 with `AUTH_SECRET`), never the code itself |

**Existing members:** someone who enters an email that already has an account gets an email saying so, instead of a code. The page answers the same way either way, so it can't be used to find out who has an account.

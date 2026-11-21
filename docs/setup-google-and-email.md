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
     - `https://marigold-and-ink-api.onrender.com/api/v1/auth/google/callback` (production)
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

**If Google won't accept the onrender.com address** (for example as an authorized domain on the consent screen), the clean fix is a custom domain for the site. You'll want one for email anyway (below). Point it at Render, update `PUBLIC_URL`, `CORS_ORIGINS`, and the redirect URI, and it works the same way.

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

Sign-up sends a 6-digit code by email. Real email needs **a domain you own** (e.g. `marigoldandink.com`), because email providers only deliver mail "from" a domain whose owner has proven control of it.

1. **Get a domain** from any registrar, if you don't have one.
2. **Create a Resend account** at <https://resend.com> (free for up to 3,000 emails a month).
3. **Add your domain** in Resend → **Domains**. Resend shows a few DNS records (TXT and MX, for SPF and DKIM). Add them at your registrar exactly as shown, then press **Verify** in Resend. DNS can take minutes to hours.
4. **Create an API key** in Resend → **API Keys**, with **sending access** only, limited to your domain.
5. **Configure the app:**
   - **On Render** (Dashboard → Environment):
     ```
     EMAIL_TRANSPORT=resend
     RESEND_API_KEY=re_...
     EMAIL_FROM=Marigold & Ink <hello@your-domain.com>
     ```
   - **Locally** you can keep the default (`log`: codes print in the server terminal), or use the same three values to receive real email.

Then sign up on the live site with your own address to check the code arrives. If sending fails, the visitor sees "We couldn't send the email" and can retry at once, and the server log says why (for example, a domain that isn't verified yet).

### How sign-up codes work

| Rule | Value |
| --- | --- |
| Code | 6 digits, random, from a cryptographic generator |
| Valid for | 15 minutes |
| Wrong tries allowed | 5; after that the visitor must request a new code |
| Resend | Once a minute; also at most 5 code requests per hour per IP address |
| Storage | Only a keyed hash (HMAC-SHA256 with `AUTH_SECRET`), never the code itself |

**Existing members:** someone who enters an email that already has an account gets an email saying so, instead of a code. The page answers the same way either way, so it can't be used to find out who has an account.

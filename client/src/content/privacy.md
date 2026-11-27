# Privacy Policy

**Effective Date:** November 23, 2026  
**Last Updated:** November 26, 2026

At **Marigold & Ink** ("we," "our," or "us"), we believe that creating art is a personal experience, and respecting your privacy is part of that experience.

This Privacy Policy explains what personal information we collect when you visit our website, create an account, sign in, request a commission, or make a payment. It also explains how we use, store, protect, and share your information, as well as the choices available to you.

By using Marigold & Ink, you acknowledge that you have read this Privacy Policy.

## 1. Information We Collect

We collect information that you voluntarily provide when using our website, along with limited technical information necessary to operate, maintain, and secure our services.

### A. Account Information

When you create an account, we collect the following information:

- **Email address:** Required for every account and used as your login and primary contact information. Email addresses are stored case-insensitively.
- **Display name:** Provided during registration or retrieved from your Google account when you choose Google Sign-In.
- **Password:** For accounts registered using email and password, your password is stored as a one-way bcrypt hash. We cannot retrieve or read your original password. Google-only accounts do not have a password stored with us.
- **Google account information:** If you sign in using Google, we receive your Google account ID, email address, email verification status, and display name. We do not collect your Google profile photo.
- **Account details:** Your account role (client or administrator), email verification date, and account creation and update timestamps.

We use this information to create and manage your account, authenticate your identity, and provide access to your commissions.

### B. Email Verification Information

When you register using an email address and password, reset a forgotten password, or change your account's email address, we send a six-digit verification code to confirm that you control the email address.

We temporarily store a hashed version of the verification code along with the associated email address, what the code is for, the number of verification attempts, and its expiration time. For an email address change, we also store which account the code belongs to.

Verification codes expire after 15 minutes. A code is deleted once it is used, and expired codes are deleted the next time any verification code is sent.

### C. Commission Information

When you submit a commission request, we collect information necessary to understand, quote, and fulfill your order.

This may include:

- Requested artwork size.
- Preferred artistic medium.
- Number of people, pets, or other subjects in the artwork.
- Whether the commission is physical or digital.
- Whether you request rush delivery.
- Additional notes, instructions, or details you voluntarily provide.
- Commission status, status history, quotes, and pricing information.

Our commission form includes a free-text notes field where you can share additional information about your request.

Please be aware that anything you enter in this field is stored in our database. This may include personal information about yourself or other individuals, such as the people appearing in a portrait.

We encourage you to share only the information necessary to complete your commission and to avoid including sensitive personal information.

### D. Payment Information

Payments are processed through **Stripe**, our third-party payment provider.

When you make a payment, you are directed to Stripe's hosted Checkout page to enter your payment details.

**Your credit or debit card information is never received or stored by Marigold & Ink.** Payment card details are entered directly on Stripe's platform.

To initiate a payment, we send Stripe the information necessary to process the transaction, including:

- Your email address.
- Payment amount and currency.
- A payment description, such as "Deposit for commission #12."
- Internal payment and commission reference numbers.

We retain payment-related records in our database, including:

- Payment amount and currency.
- Payment status.
- Stripe Checkout session ID.
- Stripe payment intent ID.
- Refund reference IDs.
- Checkout links and their expiration times.
- Refund reasons and the administrator who requested the refund.

We maintain these records to manage transactions, verify payments, process refunds, and keep accurate financial and commission histories.

Payment records cannot be independently deleted while their associated commission records exist.

For more information about how Stripe handles payment information, please review [Stripe's Privacy Policy](https://stripe.com/privacy).

### E. Reference Photos and Artwork Files

If you place a commission, you may upload reference photos to help me create your artwork. Before storage, location and camera details (metadata) are removed from uploaded photos.

Reference photos are stored using Cloudflare R2, with storage located in the United States. Reference photos are deleted 90 days after the commission ends or when your account is deleted, whichever happens first.

Previews and final artwork files are retained for one year after the commission has been fully paid. After that period, these files are deleted.

### F. Shipping Information

For physical commissions, we collect your US shipping address, including your name and street address, so we can prepare and deliver your order.

We share this information with Shippo, our shipping service provider, to validate shipping addresses, calculate postage, purchase shipping labels, and track deliveries. Shippo may process your information as needed to provide these services.

To deliver your order, your shipping address is also shared with the selected shipping carrier, such as USPS. The carrier uses this information to transport and deliver your package.

We use Resend to send shipping-related email notifications, including updates when your order ships and when it is marked as delivered. These emails may include your order details and tracking information.

If you delete your account, your name and street address are removed from your account records. However, shipping or transaction information already shared with Shippo may remain subject to Shippo's own retention practices and privacy policy.

## 2. How We Use Your Information

We use the information we collect for the following purposes:

- Creating and managing customer accounts.
- Authenticating users through email and password or Google Sign-In.
- Verifying email addresses during registration, password resets, and email address changes.
- Receiving, reviewing, and managing commission requests.
- Communicating with customers about their artwork, quotes, pricing, and orders.
- Processing deposits, payments, and refunds through Stripe.
- Maintaining commission histories and financial records.
- Managing account security and preventing unauthorized access.
- Monitoring website performance and troubleshooting technical issues.

We do not sell your personal information or use it for targeted advertising.

## 3. Google Sign-In

Marigold & Ink offers the option to create an account or sign in using your Google account.

When you select "Continue with Google," Google authenticates your identity and provides us with limited account information.

The information we receive includes:

- Your Google account ID.
- Your Google email address.
- Whether Google has verified your email address.
- Your Google account display name.

We do not request or collect your Google profile photo, Google Drive files, contacts, or other unrelated Google account information.

We use the information received from Google solely to authenticate your identity and create or manage your Marigold & Ink account.

Your use of Google's authentication services is also subject to Google's own privacy practices.

You can learn more by reviewing [Google's Privacy Policy](https://policies.google.com/privacy).

## 4. Cookies and Browser Storage

Our website uses one essential authentication cookie to maintain your signed-in session.

This cookie:

- Is necessary for account authentication and session management.
- Is marked `HttpOnly`, meaning it cannot be accessed by client-side JavaScript.
- Is marked `Secure`, meaning it is transmitted over secure connections.
- Is restricted to our website's host.
- Expires after seven days.

We do not currently use analytics cookies, advertising cookies, or behavioral tracking cookies.

We also do not use browser storage technologies such as `localStorage` or `sessionStorage` to store your personal information.

Our website's fonts are bundled directly with the application, so loading our pages does not require requests to Google Fonts.

Please note that third-party services, including Google and Stripe, may use their own cookies when you interact with their authentication or payment pages. These cookies are governed by their respective privacy policies.

## 5. How We Share Your Information

We do not sell, rent, or trade your personal information.

However, we work with third-party service providers that help us operate our website, manage customer accounts, process payments, and support our services.

These providers receive or process information only as necessary for their respective services.

### Our Third-Party Service Providers

**Render — Website Hosting**

Our website and API are hosted through Render, with hosting infrastructure located in Oregon, United States.

Render processes website traffic to provide hosting services and may maintain its own server access logs under its privacy and data-handling practices.

**Neon — Database Hosting**

We use Neon to store and manage our website's database.

Our production database is hosted on AWS infrastructure in Oregon, United States.

Neon stores the account, commission, and payment-related information described in this policy.

**Stripe — Payment Processing**

We use Stripe to process deposits, payments, and refunds.

Stripe receives the information necessary to process transactions, including your email address, payment amount, currency, and card details that you enter directly on Stripe's hosted Checkout page.

Your card information is not stored in our database.

**Google — Authentication**

We use Google Sign-In to allow customers to authenticate using their Google accounts.

Google provides the limited account information described in Section 3.

**Resend — Email Delivery**

We use Resend to deliver account emails: verification codes for registration, password resets, and email address changes, and a notice to your previous address when your account's email address is changed.

Resend receives your email address and the content of these messages, including the verification code, in order to deliver them.

**Digital Humani — Reforestation Support**

Marigold & Ink intends to use Digital Humani's Reforestation as a Service platform to support tree planting through our commission contributions.

When this integration is enabled, Digital Humani will receive a non-personal reference associated with a fully paid commission (such as `commission-12`) and the corresponding number of trees requested.

**We do not send Digital Humani your name, email address, payment details, or other personal customer information.**

Digital Humani uses this information to facilitate the tree-planting contribution associated with the commission.

You can learn more about Digital Humani at [digitalhumani.com](https://www.digitalhumani.com/).

Each third-party provider operates under its own privacy policy and data-handling practices.

## 6. Tree-Planting Contributions

Giving back to the environment is an important part of Marigold & Ink's mission.

We dedicate 25% of every commission toward supporting tree planting through Digital Humani.

When the Digital Humani integration is enabled, we send a commission reference and the number of trees associated with the contribution. No personal customer information is included in this request.

For more information about our environmental commitment, please visit our [Rooted in Something Bigger](/giving) page.

## 7. Data Storage and Security

Your personal information stored by Marigold & Ink is hosted on infrastructure located in the United States.

We take reasonable technical and organizational measures to protect your information against unauthorized access, disclosure, alteration, and destruction.

Our security practices include:

- Storing passwords as one-way bcrypt hashes rather than readable passwords.
- Protecting authentication cookies with secure cookie settings.
- Storing email verification codes as hashes.
- Limiting verification attempts.
- Using rate limiting to help prevent repeated unauthorized sign-in and registration attempts.
- Redacting sensitive information from application logs.

### Application Logs

For operational and security purposes, our application records limited technical information about website requests, including:

- Request method.
- Requested path.
- Response status.
- Request duration.
- Request ID.

Our application logs do not intentionally record IP addresses or browser user-agent information. Passwords, authorization headers, and cookie values are redacted. Google's one-time authorization code and state parameters are also excluded from logged URLs.

IP addresses may be temporarily held in application memory to apply rate limits to sign-in and sign-up attempts. They are not stored in our application database and are lost when the application restarts.

Our hosting provider, Render, may independently maintain its own request logs.

Although we take reasonable steps to protect your information, no method of online transmission or electronic storage can be guaranteed to be completely secure.

## 8. Data Retention and Account Deletion

We retain personal information for as long as reasonably necessary to provide our services, manage commissions, maintain financial records, and fulfill applicable legal obligations.

We also provide a self-service account deletion option through the [account page](/account).

### What Happens When You Delete Your Account?

When you delete your account, we anonymize the associated account information rather than immediately removing every record connected to your previous activity.

The following information is removed:

- Your account email address.
- Your display name.
- Your stored password hash.
- Your linked Google account information.
- Any pending email verification code associated with your account.
- Your active sessions.
- Your commission notes.

Your existing commission and payment records remain in our database for business and financial recordkeeping purposes. These records are associated with a generic "Deleted user" label instead of your original account identity.

### Information That May Remain After Deletion

Some information may remain even after your account has been deleted:

- **Commission status-change reasons:** If you entered a reason when changing a commission's status, that information may remain in the append-only commission history.
- **Stripe records:** Stripe may retain its own copy of your email address and transaction information according to its retention policies.
- **Database backups:** Copies of information may remain in existing database backups until those backups expire.
- **Financial and commission records:** Payment and commission histories remain for business accounting and recordkeeping purposes.

### When Account Deletion Is Unavailable

To protect ongoing transactions and commission fulfillment, account deletion is not available while you have a paid commission that is still in progress.

Once the commission is no longer in progress, you may use the account deletion option.

Deleting your account does not automatically delete information independently retained by third-party providers.

## 9. Your Privacy Rights and Choices

Depending on your location and applicable privacy laws, you may have certain rights regarding your personal information.

These rights may include:

- **Access:** Request information about the personal data we hold about you.
- **Correction:** Request corrections to inaccurate or incomplete information.
- **Deletion:** Request the deletion of personal information, subject to applicable legal and business recordkeeping requirements.
- **Data portability:** Request a copy of your personal information in a portable format, where applicable.
- **Objection or restriction:** Object to or request restrictions on certain types of processing, where applicable.
- **Withdrawal of consent:** Withdraw consent when processing is based on your consent.

You can do several of these yourself on the [account page](/account): change your display name, email address, and password, download a copy of your information as a file, and delete your account.

If you need help with any of these, or would like to exercise another applicable privacy right, please contact us using the information provided in Section 13.

We will review and respond to requests in accordance with applicable privacy laws.

## 10. International Data Transfers

Marigold & Ink is operated from the United States, and our own production database and hosting infrastructure are currently located in the United States.

If you access our website from outside the United States, including the European Economic Area, the United Kingdom, or Canada, your information may be transferred to, stored, and processed in the United States.

Our third-party service providers may also process information in other locations according to their respective infrastructure and privacy practices.

For example, Digital Humani's infrastructure is located in Canada.

Privacy and data protection laws may differ between the United States and your country of residence.

Where required by applicable law, we will take appropriate measures to protect personal information transferred internationally.

## 11. Children's Privacy

Our website is not specifically directed toward children, and we do not knowingly collect personal information directly from children under 13 without appropriate parental or guardian involvement.

If you believe a child has provided us with personal information without appropriate authorization, please contact us so that we can review the situation and take appropriate action.

## 12. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes to our website, services, data practices, third-party providers, or applicable legal requirements.

When changes are made, we will update the "Last Updated" date at the top of this page.

We encourage you to review this policy periodically to stay informed about how we collect and handle your personal information.

## 13. Contact Us

If you have questions about this Privacy Policy, would like to request access to your personal information, or wish to exercise your applicable privacy rights, please contact us.

**Marigold & Ink**

Email: [hello@noboni.art](mailto:hello@noboni.art)

Location: New York, United States

We value your trust and will do our best to address your privacy-related questions and requests in a timely manner.

Thank you for trusting Marigold & Ink with a little piece of your story.

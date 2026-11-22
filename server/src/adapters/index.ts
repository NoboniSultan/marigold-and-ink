/**
 * The third-party services the app talks to, built once from config. createApp() takes
 * these as a parameter, so tests pass fakes and never send email, call Google, or call
 * Stripe. null = the feature is switched off (not configured).
 */
import { config } from '../config/env.js';
import { createEmailSender, type EmailSender } from './email.ts';
import { createGoogleAuth, type GoogleAuth } from './googleOidc.ts';
import { createStripeGateway, type PaymentGateway } from './stripe/stripeGateway.ts';

export interface AppAdapters {
  email: EmailSender | null;
  google: GoogleAuth | null;
  payments: PaymentGateway | null;
}

export function createDefaultAdapters(): AppAdapters {
  return {
    email: createEmailSender(config.email),
    // The config check guarantees the secret is set whenever the client ID is.
    google: config.google
      ? createGoogleAuth({ ...config.google, clientSecret: config.google.clientSecret! })
      : null,
    // The config check guarantees the webhook secret is set whenever the secret key is.
    payments: config.stripe
      ? createStripeGateway({
          secretKey: config.stripe.secretKey,
          webhookSecret: config.stripe.webhookSecret!,
        })
      : null,
  };
}

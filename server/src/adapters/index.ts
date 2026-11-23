/**
 * The third-party services the app talks to, built once from config. createApp() takes
 * these as a parameter, so tests pass fakes and never send email, call Google, call
 * Stripe, or request trees. null = the feature is switched off (not configured).
 */
import { config } from '../config/env.js';
import { createEmailSender, type EmailSender } from './email.ts';
import { createGoogleAuth, type GoogleAuth } from './googleOidc.ts';
import { createStripeGateway, type PaymentGateway } from './stripe/stripeGateway.ts';
import { createTreePlanter, type TreePlanter } from './digitalHumani.ts';

export interface AppAdapters {
  email: EmailSender | null;
  google: GoogleAuth | null;
  payments: PaymentGateway | null;
  /** Optional, so tests that don't involve giving can leave it out (= giving is off). */
  trees?: TreePlanter | null;
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
    // The config check guarantees every Digital Humani setting is set whenever the key is.
    trees: config.giving
      ? createTreePlanter({
          apiKey: config.giving.apiKey,
          enterpriseId: config.giving.enterpriseId!,
          projectId: config.giving.projectId!,
          environment: config.giving.environment!,
        })
      : null,
  };
}

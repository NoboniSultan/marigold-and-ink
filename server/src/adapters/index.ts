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
import { createR2Storage, type FileStorage } from './r2Storage.ts';
import { createShippo, type ShippingSetup } from './shippo.ts';

export interface AppAdapters {
  email: EmailSender | null;
  google: GoogleAuth | null;
  payments: PaymentGateway | null;
  /** Optional, so tests that don't involve giving can leave it out (= giving is off). */
  trees?: TreePlanter | null;
  /** Optional, so tests that don't involve files can leave it out (= uploads are off). */
  storage?: FileStorage | null;
  /** Optional, so tests that don't involve shipping can leave it out (= shipping is off). */
  shipping?: ShippingSetup | null;
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
    // The config check guarantees every R2 setting is set whenever the bucket is.
    storage: config.files
      ? createR2Storage({
          accountId: config.files.accountId!,
          accessKeyId: config.files.accessKeyId!,
          secretAccessKey: config.files.secretAccessKey!,
          bucket: config.files.bucket,
        })
      : null,
    // The config check guarantees the fee and the return address whenever the key is set.
    shipping: config.shipping
      ? {
          provider: createShippo({ apiKey: config.shipping.apiKey }),
          packagingFeeCents: config.shipping.packagingFeeCents!,
          from: {
            name: config.shipping.from.name!,
            street1: config.shipping.from.street1!,
            street2: config.shipping.from.street2,
            city: config.shipping.from.city!,
            state: config.shipping.from.state!,
            zip: config.shipping.from.zip!,
          },
          webhookToken: config.shipping.webhookToken,
        }
      : null,
  };
}

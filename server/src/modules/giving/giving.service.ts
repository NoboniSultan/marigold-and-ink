/**
 * Giving (ADR 0013): a share of every fully paid commission plants trees through Digital
 * Humani.
 *
 * 1. recordForFinalPayment: inside the Stripe webhook's transaction, the final payment
 *    records a pending donation of N trees. Nothing external happens yet, so a Digital
 *    Humani outage can never fail or delay a payment.
 * 2. requestPendingTrees: after the webhook commits (and when the server starts), each
 *    pending donation is sent to Digital Humani. It runs outside any long transaction:
 *    the attempt is stamped and committed first, so if the answer is lost, the next try
 *    asks Digital Humani how many trees it already has under our reference (one per
 *    commission) instead of planting twice.
 * 3. withheldForTreesCents: the refund flow never gives back tree money.
 */
import type { PoolClient } from 'pg';
import type { TreePlanter } from '../../adapters/digitalHumani.ts';
import { withTransaction } from '../../db/transaction.ts';
import { logger } from '../../lib/logger.js';
import { treesFor } from './giving.calculator.ts';
import * as givingRepository from './giving.repository.ts';

/** An attempt younger than this may still be in flight, so it's left alone. */
export const RETRY_AFTER_MINUTES = 5;

/** The reference Digital Humani stores with a request: no personal data, ever. */
export function referenceFor(commissionId: number): string {
  return `commission-${commissionId}`;
}

/**
 * Called by the webhook, in its transaction, when a commission's final payment succeeds.
 * `donationPercent` is null when giving is off. Returns the donation's ID, or null when
 * giving is off, nothing is funded, or this payment already has its donation (a replay).
 */
export async function recordForFinalPayment(
  {
    commissionId,
    paymentId,
    totalCents,
  }: { commissionId: number; paymentId: number; totalCents: number },
  { client, donationPercent }: { client: PoolClient; donationPercent: number | null },
): Promise<number | null> {
  if (donationPercent === null) return null; // giving is off
  const { treeCount, donationCents } = treesFor(totalCents, donationPercent);
  if (treeCount === 0) return null;

  const charityId = await givingRepository.findActiveCharityId(client);
  if (charityId === null) {
    // The seed creates the active charity on every deploy, so this means a broken setup.
    // The payment still goes through; the error is loud so the owner can fix and re-plant.
    logger.error({ commissionId, paymentId }, 'no active charity: trees were not recorded');
    return null;
  }
  return givingRepository.insertTreeDonation(
    {
      paymentId,
      commissionId,
      charityId,
      percentage: donationPercent,
      baseAmountCents: totalCents,
      donationAmountCents: donationCents,
      treeCount,
    },
    client,
  );
}

export function withheldForTreesCents(commissionId: number, { client }: { client: PoolClient }) {
  return givingRepository.withheldForTreesCents(commissionId, client);
}

/** Sends every pending donation's trees. Never throws: failures stay pending for next time. */
export async function requestPendingTrees(
  planter: TreePlanter | null | undefined,
): Promise<{ requested: number; failed: number }> {
  const result = { requested: 0, failed: 0 };
  if (!planter) return result;

  for (const id of await givingRepository.listPendingTreeDonationIds()) {
    try {
      if (await requestOne(id, planter)) result.requested += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn({ err, donationId: id }, 'tree request failed; it stays pending for a retry');
    }
  }
  return result;
}

/** One donation. Returns true if it is now requested, false if another attempt owns it. */
async function requestOne(id: number, planter: TreePlanter): Promise<boolean> {
  // Claim and stamp the attempt in its own short transaction, committed before calling out.
  const donation = await withTransaction((tx) =>
    givingRepository.claimForRequest(id, RETRY_AFTER_MINUTES, tx),
  );
  if (!donation) return false;

  const reference = referenceFor(donation.commissionId);
  // Tried before without hearing back: the request may have gone through. Digital Humani
  // can't list requests, but it counts the trees under a reference, and each commission
  // has its own. Whatever is already there counts toward this donation.
  const alreadyRequested = donation.requestAttemptedAt ? await planter.countTrees(reference) : 0;
  const missing = donation.treeCount - alreadyRequested;
  const requestId =
    missing > 0 ? (await planter.plantTrees({ treeCount: missing, reference })).uuid : null;

  await givingRepository.markRequested(donation.id, requestId);
  logger.info(
    {
      donationId: donation.id,
      commissionId: donation.commissionId,
      trees: donation.treeCount,
      alreadyRequested,
    },
    'trees requested through Digital Humani',
  );
  return true;
}

/** GET /giving: the public total for the Giving page. */
export async function getPublicTotals(): Promise<{ trees: number }> {
  return { trees: await givingRepository.treesFunded() };
}

/**
 * The charity donations are recorded against: the owner's choice in milestone 8, One Tree
 * Planted's projects, reached through Digital Humani. The seed runs this on every deploy.
 */
export const DEFAULT_CHARITY = Object.freeze({
  name: 'One Tree Planted (through Digital Humani)',
  description: 'Trees planted through Digital Humani, with One Tree Planted as the partner.',
  websiteUrl: 'https://onetreeplanted.org',
});

export function ensureCharity() {
  return givingRepository.ensureActiveCharity(DEFAULT_CHARITY);
}

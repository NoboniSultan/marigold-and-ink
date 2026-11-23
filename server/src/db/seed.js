/**
 * CLI: npm run seed
 * Runs every seed in order. Each seed must be idempotent (safe to run repeatedly),
 * because the deploy runs this on every start.
 */
import { logger } from '../lib/logger.js';
import { pool } from './pool.js';
import { seedAdmin } from './seeds/admin.js';
import { seedPlaceholderPricing } from './seeds/pricing.placeholder.js';
import { seedContent } from './seeds/content.ts';
import { seedCharity } from './seeds/charity.ts';

try {
  const admin = await seedAdmin();
  if (admin.skipped) logger.warn({ reason: admin.reason }, 'admin seed skipped');
  else logger.info({ userId: admin.userId, created: admin.created }, 'admin seed done');

  const pricing = await seedPlaceholderPricing();
  if (pricing.skipped) logger.info({ reason: pricing.reason }, 'placeholder pricing seed skipped');
  else
    logger.warn(
      { inserted: pricing.inserted },
      'PLACEHOLDER pricing seeded: replace with real prices',
    );

  const charity = await seedCharity();
  logger.info({ charity }, 'charity seed done');

  const content = await seedContent();
  logger.info(
    {
      inserted: content.inserted.length,
      updated: content.updated.length,
      removed: content.removed.length,
      unchanged: content.unchanged,
      published: content.published,
      drafts: content.drafts,
    },
    'content seed done',
  );
  if (content.aboutIsPlaceholder) {
    logger.warn('content/about.json still has PLACEHOLDER text');
  }
} catch (err) {
  logger.fatal({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}

import * as quotesRepository from './quotes.repository.js';
import * as commissionsService from '../commissions/commissions.service.js';
import * as pricingService from '../pricing/pricing.service.js';
import { calculateQuote } from '../pricing/pricing.engine.js';
import { actorFromUser } from '../commissions/commissions.stateMachine.js';
import { withTransaction } from '../../db/transaction.js';
import { ConflictError, NotFoundError } from '../../errors/index.js';
import { splitDeposit } from '../../lib/money.js';
import { config } from '../../config/env.js';

function quoteNotFound() {
  return new NotFoundError('No quote for this commission', { code: 'QUOTE_NOT_FOUND' });
}

/** The price that applies: the admin's adjustment if there is one, otherwise the computed price. */
function totalOf(quote) {
  return quote.adjustedAmountCents ?? quote.computedAmountCents;
}

/** API shape: the stored quote plus the total and the deposit/balance it implies. */
function toQuoteView(quote) {
  const totalCents = totalOf(quote);
  return { ...quote, totalCents, ...splitDeposit(totalCents, config.depositPercent) };
}

async function requireDraft(commissionId, client) {
  const quote = await quotesRepository.findCurrent(commissionId, client);
  if (!quote) throw quoteNotFound();
  if (quote.status !== 'draft') {
    throw new ConflictError('This quote has already been sent and can no longer change', {
      code: 'QUOTE_NOT_EDITABLE',
      details: { status: quote.status },
    });
  }
  return quote;
}

/**
 * Admin: compute a draft quote from the active pricing rules. Only while the commission is
 * an inquiry. Generating again replaces the previous draft (it's marked superseded, so the
 * history stays). The commission row is locked so two generations can't race.
 */
export async function generateQuote(commissionId) {
  return withTransaction(async (client) => {
    const commission = await commissionsService.lockCommission(commissionId, client);
    if (commission.status !== 'inquiry') {
      throw new ConflictError('Quotes can only be prepared while the commission is an inquiry', {
        code: 'QUOTE_NOT_ALLOWED',
        details: { status: commission.status },
      });
    }

    const rules = await pricingService.getActiveRules(client);
    const { lineItems, totalCents } = calculateQuote(commission, rules);

    const existing = await quotesRepository.findCurrent(commissionId, client);
    if (existing) await quotesRepository.supersede(existing.id, client);

    const quote = await quotesRepository.insertDraft(
      { commissionId, computedAmountCents: totalCents, lineItems },
      client,
    );
    return toQuoteView(quote);
  });
}

/** Admin: override the computed price on a draft. A note explaining why is required. */
export async function adjustQuote(commissionId, { adjustedAmountCents, adjustmentNote }) {
  return withTransaction(async (client) => {
    await commissionsService.lockCommission(commissionId, client);
    const draft = await requireDraft(commissionId, client);
    const quote = await quotesRepository.setAdjustment(
      draft.id,
      { adjustedAmountCents, adjustmentNote },
      client,
    );
    return toQuoteView(quote);
  });
}

/**
 * Admin: send the draft to the client. In ONE transaction:
 *   - the quote becomes 'sent' (sent_at recorded),
 *   - the commission gets its total, deposit and balance,
 *   - the commission moves inquiry -> quoted, with an event naming the quote.
 * The deposit split uses DEPOSIT_PERCENT at the moment of sending and is stored on the
 * commission, so changing the setting later never changes a quote the client already has.
 */
export async function sendQuote(commissionId, admin) {
  return withTransaction(async (client) => {
    await commissionsService.lockCommission(commissionId, client);
    const draft = await requireDraft(commissionId, client);

    const quotedTotalCents = totalOf(draft);
    const { depositCents, balanceCents } = splitDeposit(quotedTotalCents, config.depositPercent);

    const quote = await quotesRepository.markSent(draft.id, client);
    const commission = await commissionsService.applyTransition(
      {
        commissionId,
        toStatus: 'quoted',
        actor: actorFromUser(admin),
        via: 'quote',
        reason: 'Quote sent',
        metadata: {
          quoteId: quote.id,
          totalCents: quotedTotalCents,
          depositPercent: config.depositPercent,
        },
        extraChanges: { quotedTotalCents, depositCents, balanceCents },
      },
      { client },
    );
    return { commission, quote: toQuoteView(quote) };
  });
}

/**
 * The current quote. Admins see drafts; clients only see a quote once it has been sent,
 * so a work-in-progress price is never shown to them.
 */
export async function getQuote(commissionId, user) {
  await commissionsService.getCommissionForUser(commissionId, user); // 404 / 403
  const quote = await quotesRepository.findCurrent(commissionId);
  if (!quote || (user.role !== 'admin' && quote.status === 'draft')) throw quoteNotFound();
  return toQuoteView(quote);
}

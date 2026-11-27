import { describe, it, expect } from 'vitest';
import {
  STATUSES,
  TERMINAL_STATUSES,
  SYSTEM_ACTOR,
  actorFromUser,
  canTransition,
  assertTransition,
  availableTransitions,
} from '../commissions.stateMachine.ts';
import { BusinessRuleError, ConflictError, ForbiddenError } from '../../../errors/index.js';

// The approved transition table, written out independently of the implementation so the
// test can catch mistakes in TRANSITIONS rather than mirror them.
const EXPECTED = {
  'inquiry>quoted': { actors: ['admin'], via: 'quote' },
  'inquiry>canceled': { actors: ['client', 'admin'] },
  'quoted>canceled': { actors: ['client', 'admin'] },
  'quoted>deposit_paid': { actors: ['system'] },
  'deposit_paid>in_progress': { actors: ['admin'] },
  'deposit_paid>refunded': { actors: ['admin', 'system'], via: 'refund' },
  'in_progress>revision': { actors: ['client'] },
  'in_progress>awaiting_final_payment': { actors: ['client', 'admin'] },
  'in_progress>refunded': { actors: ['admin', 'system'], via: 'refund' },
  'revision>in_progress': { actors: ['admin'] },
  'awaiting_final_payment>ready_to_ship': { actors: ['system'], fulfillment: 'physical' },
  'awaiting_final_payment>delivered': { actors: ['system'], fulfillment: 'digital or mixed_media' },
  'awaiting_final_payment>refunded': { actors: ['admin', 'system'], via: 'refund' },
  'ready_to_ship>shipped': { actors: ['admin', 'system'] },
  'shipped>delivered': { actors: ['admin', 'system'] },
  'delivered>completed': { actors: ['admin'] },
};

const OWNER = { type: 'client', userId: 10 };
const OTHER_CLIENT = { type: 'client', userId: 99 };
const ADMIN = { type: 'admin', userId: 1 };
const ACTORS = { client: OWNER, admin: ADMIN, system: SYSTEM_ACTOR };

function commission(overrides = {}) {
  return {
    id: 1,
    clientId: 10,
    status: 'inquiry',
    fulfillmentType: 'physical',
    revisionCount: 0,
    revisionLimit: 2,
    ...overrides,
  };
}

describe('transition map (all 144 status pairs x 3 actor types)', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = EXPECTED[`${from}>${to}`];
      const c = commission({ status: from, fulfillmentType: expected?.fulfillment ?? 'physical' });

      if (expected) {
        for (const [actorType, actor] of Object.entries(ACTORS)) {
          const shouldAllow = expected.actors.includes(actorType);
          it(`${from} -> ${to} by ${actorType}: ${shouldAllow ? 'allowed' : 'forbidden'}`, () => {
            const result = canTransition(c, to, actor, { via: expected.via });
            expect(result.allowed).toBe(shouldAllow);
            if (shouldAllow) expect(result.changes.status).toBe(to);
            else expect(result.failure.kind).toBe('forbidden');
          });
        }
      } else {
        it(`${from} -> ${to}: invalid for every actor`, () => {
          for (const actor of Object.values(ACTORS)) {
            for (const via of [undefined, 'quote', 'refund']) {
              const result = canTransition(c, to, actor, { via });
              expect(result.allowed).toBe(false);
              expect(result.failure.kind).toBe('invalid');
            }
          }
        });
      }
    }
  }

  it('has exactly the approved set of transitions', () => {
    const allowedPairs = STATUSES.flatMap((from) =>
      STATUSES.filter((to) =>
        Object.values(ACTORS).some((actor) =>
          ['quote', 'refund', undefined].some(
            (via) =>
              canTransition(
                commission({
                  status: from,
                  fulfillmentType: to === 'delivered' ? 'digital' : 'physical',
                }),
                to,
                actor,
                { via },
              ).allowed,
          ),
        ),
      ).map((to) => `${from}>${to}`),
    );
    // (Digital fulfillment is used for -> delivered so the digital-only guard can pass.)
    expect(new Set(allowedPairs)).toEqual(new Set(Object.keys(EXPECTED)));
  });
});

describe('terminal statuses', () => {
  it.each(TERMINAL_STATUSES)('%s has no way out', (status) => {
    for (const to of STATUSES) {
      const result = canTransition(commission({ status }), to, ADMIN);
      expect(result.allowed).toBe(false);
      expect(result.failure.message).toBe(`A ${status} commission can't change status`);
    }
  });
});

describe('dedicated flows (via)', () => {
  it('only allows -> quoted through the quote flow', () => {
    expect(canTransition(commission(), 'quoted', ADMIN).failure).toMatchObject({
      kind: 'invalid',
      message: 'Moving to quoted requires the quote flow',
    });
    expect(canTransition(commission(), 'quoted', ADMIN, { via: 'refund' }).allowed).toBe(false);
    expect(canTransition(commission(), 'quoted', ADMIN, { via: 'quote' }).allowed).toBe(true);
  });

  it('only allows -> refunded through the refund flow', () => {
    const c = commission({ status: 'in_progress' });
    expect(canTransition(c, 'refunded', ADMIN).allowed).toBe(false);
    expect(canTransition(c, 'refunded', ADMIN, { via: 'refund' }).allowed).toBe(true);
  });
});

describe('client ownership', () => {
  it("forbids a client from acting on someone else's commission", () => {
    const result = canTransition(commission(), 'canceled', OTHER_CLIENT);

    expect(result.allowed).toBe(false);
    expect(result.failure.kind).toBe('forbidden');
  });

  it('forbids a missing actor', () => {
    expect(canTransition(commission(), 'canceled', undefined).failure.kind).toBe('forbidden');
  });
});

describe('guards', () => {
  it('allows a revision while revisions remain', () => {
    const c = commission({ status: 'in_progress', revisionCount: 1, revisionLimit: 2 });
    expect(canTransition(c, 'revision', OWNER).allowed).toBe(true);
  });

  it('blocks a revision once the limit is reached', () => {
    const c = commission({ status: 'in_progress', revisionCount: 2, revisionLimit: 2 });

    expect(canTransition(c, 'revision', OWNER).failure).toEqual({
      kind: 'business',
      code: 'REVISION_LIMIT_REACHED',
      message: 'All 2 revisions have been used',
    });
  });

  it('blocks revisions entirely when the limit is 0', () => {
    const c = commission({ status: 'in_progress', revisionCount: 0, revisionLimit: 0 });
    expect(canTransition(c, 'revision', OWNER).allowed).toBe(false);
  });

  it('physical work goes to ready_to_ship, not straight to delivered', () => {
    const c = commission({ status: 'awaiting_final_payment', fulfillmentType: 'physical' });

    expect(canTransition(c, 'ready_to_ship', SYSTEM_ACTOR).allowed).toBe(true);
    expect(canTransition(c, 'delivered', SYSTEM_ACTOR).failure).toMatchObject({
      kind: 'invalid',
      message: 'Physical commissions must be shipped before delivery',
    });
  });

  // Mixed media is a sketch finished digitally, delivered as files (owner, 2026-11-25).
  it.each(['digital', 'mixed_media'])(
    '%s work goes straight to delivered and is never shipped',
    (type) => {
      const c = commission({ status: 'awaiting_final_payment', fulfillmentType: type });

      expect(canTransition(c, 'delivered', SYSTEM_ACTOR).allowed).toBe(true);
      expect(canTransition(c, 'ready_to_ship', SYSTEM_ACTOR).failure).toMatchObject({
        kind: 'invalid',
        message: 'Digital and mixed-media commissions are delivered as files, not shipped',
      });
    },
  );
});

describe('effects', () => {
  it('counts a revision as used when work resumes after it', () => {
    const c = commission({ status: 'revision', revisionCount: 1 });

    expect(canTransition(c, 'in_progress', ADMIN).changes).toEqual({
      status: 'in_progress',
      revisionCount: 2,
    });
  });

  it('changes only the status for transitions without effects', () => {
    expect(canTransition(commission(), 'canceled', OWNER).changes).toEqual({ status: 'canceled' });
  });
});

describe('assertTransition', () => {
  it('returns the transition and changes when allowed', () => {
    expect(assertTransition(commission(), 'canceled', OWNER).changes).toEqual({
      status: 'canceled',
    });
  });

  it('throws 409 COMMISSION_INVALID_TRANSITION for a move that does not exist', () => {
    const run = () => assertTransition(commission(), 'shipped', ADMIN);

    expect(run).toThrow(ConflictError);
    try {
      run();
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.code).toBe('COMMISSION_INVALID_TRANSITION');
      expect(err.details).toEqual({ from: 'inquiry', to: 'shipped' });
    }
  });

  it('throws 403 COMMISSION_TRANSITION_FORBIDDEN for the wrong actor', () => {
    const run = () =>
      assertTransition(commission({ status: 'deposit_paid' }), 'in_progress', OWNER);

    expect(run).toThrow(ForbiddenError);
    expect(run).toThrow(expect.objectContaining({ code: 'COMMISSION_TRANSITION_FORBIDDEN' }));
  });

  it('throws 422 with the guard code when a business rule blocks it', () => {
    const c = commission({ status: 'in_progress', revisionCount: 2, revisionLimit: 2 });
    const run = () => assertTransition(c, 'revision', OWNER);

    expect(run).toThrow(BusinessRuleError);
    expect(run).toThrow(expect.objectContaining({ status: 422, code: 'REVISION_LIMIT_REACHED' }));
  });
});

describe('availableTransitions', () => {
  it('lists what the owner can do from in_progress', () => {
    const c = commission({ status: 'in_progress' });
    expect(availableTransitions(c, OWNER)).toEqual(['revision', 'awaiting_final_payment']);
  });

  it('excludes flows that need a dedicated endpoint (quote, refund)', () => {
    expect(availableTransitions(commission({ status: 'in_progress' }), ADMIN)).toEqual([
      'awaiting_final_payment',
    ]);
    expect(availableTransitions(commission(), ADMIN)).toEqual(['canceled']);
  });

  it('drops revision once the limit is reached', () => {
    const c = commission({ status: 'in_progress', revisionCount: 2, revisionLimit: 2 });
    expect(availableTransitions(c, OWNER)).toEqual(['awaiting_final_payment']);
  });

  it('gives another client nothing', () => {
    expect(availableTransitions(commission(), OTHER_CLIENT)).toEqual([]);
  });
});

describe('actorFromUser', () => {
  it('maps roles to actors', () => {
    expect(actorFromUser({ id: 5, role: 'admin' })).toEqual({ type: 'admin', userId: 5 });
    expect(actorFromUser({ id: 6, role: 'client' })).toEqual({ type: 'client', userId: 6 });
  });
});

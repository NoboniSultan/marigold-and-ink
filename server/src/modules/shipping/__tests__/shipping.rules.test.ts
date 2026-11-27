import { describe, it, expect } from 'vitest';
import {
  ADDRESS_STATUSES,
  addressOpen,
  choosingOpen,
  isDeliveryProblem,
  labelOpen,
  offered,
  shippingCents,
  ships,
  trackingCarrier,
  trackingMoves,
  voidable,
} from '../shipping.rules.ts';
import { STATUSES } from '../../commissions/commissions.stateMachine.ts';

describe('ships', () => {
  it('ships physical work only; digital and mixed media are delivered as files', () => {
    expect(ships('physical')).toBe(true);
    expect(ships('digital')).toBe(false);
    expect(ships('mixed_media')).toBe(false);
  });
});

describe('when the address, package, and choice can change', () => {
  it('opens the address from the deposit until the final payment', () => {
    const open = STATUSES.filter(addressOpen);
    expect(open).toEqual([...ADDRESS_STATUSES]);
  });

  it('opens the choice only while the final payment is due', () => {
    expect(STATUSES.filter(choosingOpen)).toEqual(['awaiting_final_payment']);
  });
});

describe('offered', () => {
  const rate = (serviceToken: string, amountCents: number) => ({ serviceToken, amountCents });

  it('keeps the tracked USPS services, cheapest first', () => {
    expect(
      offered([
        rate('usps_priority_express', 3000),
        rate('usps_media_mail', 300),
        rate('ups_ground', 800),
        rate('usps_priority', 1200),
        rate('usps_ground_advantage', 700),
      ]),
    ).toEqual([
      rate('usps_ground_advantage', 700),
      rate('usps_priority', 1200),
      rate('usps_priority_express', 3000),
    ]);
  });
});

describe('shippingCents', () => {
  it('adds the packaging fee to the postage, in whole cents', () => {
    expect(shippingCents(758, 400)).toBe(1158);
    expect(shippingCents(758, 0)).toBe(758);
    expect(() => shippingCents(7.5, 400)).toThrow(TypeError);
  });
});

describe('labels', () => {
  it('can be bought only once paid and before it ships', () => {
    expect(STATUSES.filter(labelOpen)).toEqual(['ready_to_ship']);
  });

  it('can be voided until the carrier scans the package', () => {
    expect(voidable('unknown')).toBe(true);
    expect(voidable('pre_transit')).toBe(true);
    for (const status of ['transit', 'delivered', 'returned', 'failure'] as const) {
      expect(voidable(status)).toBe(false);
    }
  });

  it("are tracked with the carrier's token", () => {
    expect(trackingCarrier(' USPS ')).toBe('usps');
  });
});

describe('trackingMoves', () => {
  // Every stage against every tracking status: only these move anything.
  const EXPECTED: Record<string, string[]> = {
    'ready>transit': ['shipped'],
    'ready>delivered': ['shipped', 'delivered'],
    'shipped>delivered': ['delivered'],
  };
  const TRACKING = [
    'unknown',
    'pre_transit',
    'transit',
    'delivered',
    'returned',
    'failure',
  ] as const;
  const STAGES = ['ready', 'shipped', 'delivered', 'other'] as const;

  it.each(STAGES.flatMap((stage) => TRACKING.map((tracking) => [stage, tracking] as const)))(
    '%s + %s',
    (stage, tracking) => {
      expect(trackingMoves(stage, tracking)).toEqual(EXPECTED[`${stage}>${tracking}`] ?? []);
    },
  );

  it('treats returned and failed deliveries as problems for the owner', () => {
    expect(TRACKING.filter(isDeliveryProblem)).toEqual(['returned', 'failure']);
  });
});

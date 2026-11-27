/**
 * Checks shared by the shipping services (address and prices, labels, tracking), kept apart
 * so those services don't import each other.
 */
import { ShippingProviderError, type ShippingSetup } from '../../adapters/shippo.ts';
import { AppError, ConflictError, ServiceUnavailableError } from '../../errors/index.js';
import { logger } from '../../lib/logger.js';
import { ships } from './shipping.rules.ts';

export interface SessionUser {
  id: number;
  role: 'client' | 'admin';
}

export interface CommissionLike {
  id: number;
  status: string;
  fulfillmentType: string;
}

export type Setup = ShippingSetup | null | undefined;

export function requireShipping(setup: Setup): ShippingSetup {
  if (!setup) {
    throw new ServiceUnavailableError("Shipping isn't available yet.", {
      code: 'SHIPPING_UNAVAILABLE',
    });
  }
  return setup;
}

/** The shipping service failed or didn't answer: a 502 with a message that's safe to show. */
export async function viaProvider<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof ShippingProviderError)) throw err;
    logger.error({ err }, 'shipping provider error');
    throw new AppError("The shipping service couldn't be reached. Please try again.", {
      status: 502,
      code: 'SHIPPING_PROVIDER_ERROR',
    });
  }
}

export function assertShips(commission: CommissionLike) {
  if (!ships(commission.fulfillmentType)) {
    throw new ConflictError('This commission is delivered as files, not shipped', {
      code: 'DOES_NOT_SHIP',
    });
  }
}

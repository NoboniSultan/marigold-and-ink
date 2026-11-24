/**
 * Digital Humani's "Reforestation as a Service" API: the only code that calls it.
 * https://docs.digitalhumani.com/
 *
 * - POST /tree asks a planting partner to plant `treeCount` trees. Trees cost $1 each and
 *   the partner invoices the owner directly; the API itself doesn't take money.
 * - A request can't be cancelled, and the API has no idempotency key and no way to list
 *   requests. So the `user` field carries our own reference, one per commission (e.g.
 *   "commission-12"), and GET /tree?enterpriseId=&user= *counts* the trees under it: the
 *   giving service checks that count before it retries, so a request that went through
 *   without an answer is never sent twice.
 * - `user` is our reference, never a client's name or email: Digital Humani gets no
 *   personal data.
 */
import { z } from 'zod';

const BASE_URLS = {
  sandbox: 'https://api.sandbox.digitalhumani.com',
  production: 'https://api.digitalhumani.com',
} as const;

export interface TreeRequest {
  /** Digital Humani's ID for the request. */
  uuid: string;
  treeCount: number;
}

export interface TreePlanter {
  plantTrees(input: { treeCount: number; reference: string }): Promise<TreeRequest>;
  /** Trees already requested under `reference`, to avoid planting twice after a lost answer. */
  countTrees(reference: string): Promise<number>;
}

export class TreePlanterError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TreePlanterError';
    this.status = status;
  }
}

const treeSchema = z.object({ uuid: z.string().min(1), treeCount: z.number().int().positive() });
/** GET /tree?enterpriseId=&user= answers `{ enterpriseId, user, count }`. */
const countSchema = z.object({ count: z.number().int().nonnegative() });

const REQUEST_TIMEOUT_MS = 10_000;

export function createTreePlanter({
  apiKey,
  enterpriseId,
  projectId,
  environment,
  fetchImpl = fetch,
}: {
  apiKey: string;
  enterpriseId: string;
  projectId: string;
  environment: keyof typeof BASE_URLS;
  fetchImpl?: typeof fetch;
}): TreePlanter {
  const base = BASE_URLS[environment];

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new TreePlanterError('Digital Humani could not be reached', null, { cause: err });
    }
    if (!response.ok) {
      throw new TreePlanterError(`Digital Humani answered ${response.status}`, response.status);
    }
    return response.json();
  }

  return {
    async plantTrees({ treeCount, reference }) {
      const body = await call('/tree', {
        method: 'POST',
        body: JSON.stringify({ enterpriseId, projectId, user: reference, treeCount }),
      });
      const parsed = treeSchema.safeParse(body);
      if (!parsed.success) throw new TreePlanterError('Unexpected answer from Digital Humani', 200);
      return parsed.data;
    },

    async countTrees(reference) {
      const query = new URLSearchParams({ enterpriseId, user: reference });
      const body = await call(`/tree?${query}`);
      const parsed = countSchema.safeParse(body);
      if (!parsed.success) throw new TreePlanterError('Unexpected answer from Digital Humani', 200);
      return parsed.data.count;
    },
  };
}

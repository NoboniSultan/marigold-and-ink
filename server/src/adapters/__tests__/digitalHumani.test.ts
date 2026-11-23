/** The real Digital Humani adapter, with a fake fetch: no request ever leaves the machine. */
import { describe, it, expect, vi } from 'vitest';
import { TreePlanterError, createTreePlanter } from '../digitalHumani.ts';

function planterWith(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) =>
    respond(String(url), init),
  );
  const planter = createTreePlanter({
    apiKey: 'test-key',
    enterpriseId: 'ent-1',
    projectId: 'proj-1',
    environment: 'sandbox',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { planter, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createTreePlanter', () => {
  it('posts a tree request to the sandbox with the key, enterprise, project, and reference', async () => {
    const { planter, fetchImpl } = planterWith(() =>
      json({ uuid: 'abc-123', treeCount: 28, enterpriseId: 'ent-1' }),
    );

    await expect(
      planter.plantTrees({ treeCount: 28, reference: 'commission-12' }),
    ).resolves.toEqual({
      uuid: 'abc-123',
      treeCount: 28,
    });

    const [url, init = {}] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.sandbox.digitalhumani.com/tree');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Api-Key': 'test-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      enterpriseId: 'ent-1',
      projectId: 'proj-1',
      user: 'commission-12',
      treeCount: 28,
    });
  });

  it('uses the production address in production', async () => {
    const fetchImpl = vi.fn(async () => json({ uuid: 'p-1', treeCount: 1 }));
    const planter = createTreePlanter({
      apiKey: 'k',
      enterpriseId: 'e',
      projectId: 'p',
      environment: 'production',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await planter.plantTrees({ treeCount: 1, reference: 'commission-1' });
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(
      'https://api.digitalhumani.com/tree',
    );
  });

  it('lists earlier requests for a reference', async () => {
    const { planter, fetchImpl } = planterWith(() =>
      json([{ uuid: 'abc-123', treeCount: 28, user: 'commission-12' }]),
    );

    await expect(planter.findRequests('commission-12')).resolves.toEqual([
      { uuid: 'abc-123', treeCount: 28 },
    ]);
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'https://api.sandbox.digitalhumani.com/tree?enterpriseId=ent-1&user=commission-12',
    );
  });

  it('reports an error status', async () => {
    const { planter } = planterWith(() => json({ message: 'nope' }, 503));
    await expect(planter.plantTrees({ treeCount: 1, reference: 'c' })).rejects.toMatchObject({
      name: 'TreePlanterError',
      status: 503,
    });
  });

  it('reports a network failure', async () => {
    const { planter } = planterWith(() => {
      throw new TypeError('fetch failed');
    });
    await expect(planter.findRequests('c')).rejects.toThrow(TreePlanterError);
  });

  it('refuses an answer it does not understand', async () => {
    const { planter } = planterWith(() => json({ id: 'no-uuid-here' }));
    await expect(planter.plantTrees({ treeCount: 1, reference: 'c' })).rejects.toThrow(
      /Unexpected answer/,
    );
    const { planter: lister } = planterWith(() => json({ not: 'a list' }));
    await expect(lister.findRequests('c')).rejects.toThrow(/Unexpected answer/);
  });
});

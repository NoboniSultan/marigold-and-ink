import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { STATUSES } from '../commissions.stateMachine.ts';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createUser,
  createPricingRule,
  createCommission,
  createQuotedCommission,
} from '../../../../tests/factories/index.js';
import { loggedInAgent, TRUSTED_ORIGIN } from '../../../../tests/helpers/auth.js';

const app = createApp();
beforeEach(truncateAllTables);

const validRequest = () => ({
  size: 'test-size',
  medium: 'test-medium',
  subjectCount: 2,
  fulfillmentType: 'physical',
  isRush: true,
  notes: 'Two cats on a windowsill',
});

async function events(commissionId) {
  const { rows } = await pool.query(
    'SELECT * FROM commission_events WHERE commission_id = $1 ORDER BY id',
    [commissionId],
  );
  return rows;
}

describe('POST /api/v1/commissions', () => {
  beforeEach(() => createPricingRule({ size: 'test-size', medium: 'test-medium' }));

  it('creates an inquiry for the client, with a creation event', async () => {
    const { agent, user } = await loggedInAgent(app);

    const res = await agent
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send(validRequest());

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      clientId: user.id,
      status: 'inquiry',
      size: 'test-size',
      subjectCount: 2,
      isRush: true,
      revisionCount: 0,
      revisionLimit: 2, // from COMMISSION_REVISION_LIMIT (test value)
      quotedTotalCents: null,
    });
    const [event] = await events(res.body.data.id);
    expect(event).toMatchObject({
      from_status: null,
      to_status: 'inquiry',
      actor_type: 'client',
      actor_user_id: user.id,
    });
  });

  it('ignores any prices the client sends', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        ...validRequest(),
        quotedTotalCents: 1,
        depositCents: 1,
        balanceCents: 0,
        status: 'deposit_paid',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'inquiry',
      quotedTotalCents: null,
      depositCents: null,
      balanceCents: null,
    });
  });

  it('rejects a size + medium with no active price (422 UNSUPPORTED_SIZE_MEDIUM)', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ ...validRequest(), medium: 'gold-leaf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'UNSUPPORTED_SIZE_MEDIUM',
      details: { size: 'test-size', medium: 'gold-leaf' },
    });
  });

  it.each([
    ['zero subjects', { subjectCount: 0 }, 'subjectCount'],
    ['an unknown fulfillment type', { fulfillmentType: 'carrier_pigeon' }, 'fulfillmentType'],
    ['a missing size', { size: undefined }, 'size'],
  ])('rejects %s with 400', async (_label, override, field) => {
    const { agent } = await loggedInAgent(app);

    const res = await agent
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ ...validRequest(), ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: field })]),
    );
  });

  it('returns 401 without a session', async () => {
    const res = await request(app)
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send(validRequest());

    expect(res.status).toBe(401);
  });

  it('returns 403 for an admin (requests come from clients)', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send(validRequest());

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/commissions', () => {
  it('shows a client only their own commissions', async () => {
    const { agent, user } = await loggedInAgent(app);
    const mine = await createCommission({ clientId: user.id });
    await createCommission(); // someone else's

    const res = await agent.get('/api/v1/commissions');

    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.id)).toEqual([mine.id]);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
  });

  it('shows an admin every commission, filterable by status, paginated', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    await createCommission();
    await createCommission();
    await createQuotedCommission();

    const all = await agent.get('/api/v1/commissions?pageSize=2');
    const quoted = await agent.get('/api/v1/commissions?status=quoted');

    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 2, total: 3 });
    expect(quoted.body.data.map((c) => c.status)).toEqual(['quoted']);
    expect(quoted.body.meta.total).toBe(1);
  });

  it('rejects an unknown status filter with 400', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent.get('/api/v1/commissions?status=teleported');

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'query', path: 'status' });
  });

  it('returns 401 without a session', async () => {
    expect((await request(app).get('/api/v1/commissions')).status).toBe(401);
  });
});

describe('GET /api/v1/commissions/:id', () => {
  it('shows the owner their commission and the actions available to them', async () => {
    const { agent, user } = await loggedInAgent(app);
    const commission = await createCommission({ clientId: user.id });

    const res = await agent.get(`/api/v1/commissions/${commission.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: commission.id, availableTransitions: ['canceled'] });
  });

  it("returns 403 for another client's commission", async () => {
    const { agent } = await loggedInAgent(app);
    const other = await createCommission();

    const res = await agent.get(`/api/v1/commissions/${other.id}`);

    expect(res.status).toBe(403);
  });

  it('lets an admin view any commission', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createCommission();

    expect((await agent.get(`/api/v1/commissions/${commission.id}`)).status).toBe(200);
  });

  it('returns 404 COMMISSION_NOT_FOUND for a missing commission', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });

    const res = await agent.get('/api/v1/commissions/999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMMISSION_NOT_FOUND');
  });

  it('returns 400 for a non-numeric id and 401 without a session', async () => {
    const { agent } = await loggedInAgent(app);

    expect((await agent.get('/api/v1/commissions/abc')).status).toBe(400);
    expect((await request(app).get('/api/v1/commissions/1')).status).toBe(401);
  });
});

describe('POST /api/v1/commissions/:id/transitions', () => {
  const transition = (agent, id, body) =>
    agent.post(`/api/v1/commissions/${id}/transitions`).set('Origin', TRUSTED_ORIGIN).send(body);

  it('lets a client cancel their own inquiry, recording who and why', async () => {
    const { agent, user } = await loggedInAgent(app);
    const commission = await createCommission({ clientId: user.id });

    const res = await transition(agent, commission.id, {
      toStatus: 'canceled',
      reason: 'Changed my mind',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('canceled');
    const last = (await events(commission.id)).at(-1);
    expect(last).toMatchObject({
      from_status: 'inquiry',
      to_status: 'canceled',
      actor_type: 'client',
      actor_user_id: user.id,
      reason: 'Changed my mind',
    });
  });

  it('lets an admin start work after the deposit', async () => {
    const { agent, user: admin } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createQuotedCommission({ status: 'deposit_paid' });

    const res = await transition(agent, commission.id, { toStatus: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
    expect((await events(commission.id)).at(-1)).toMatchObject({
      actor_type: 'admin',
      actor_user_id: admin.id,
    });
  });

  it('runs the revision cycle and counts revisions', async () => {
    const { agent: clientAgent, user } = await loggedInAgent(app);
    const { agent: adminAgent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createQuotedCommission({ clientId: user.id, status: 'in_progress' });

    for (let i = 1; i <= 2; i += 1) {
      expect((await transition(clientAgent, commission.id, { toStatus: 'revision' })).status).toBe(
        200,
      );
      const resumed = await transition(adminAgent, commission.id, { toStatus: 'in_progress' });
      expect(resumed.body.data.revisionCount).toBe(i);
    }

    const third = await transition(clientAgent, commission.id, { toStatus: 'revision' });
    expect(third.status).toBe(422);
    expect(third.body.error.code).toBe('REVISION_LIMIT_REACHED');
  });

  it('returns 409 COMMISSION_INVALID_TRANSITION for a move that does not exist', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createCommission();

    const res = await transition(agent, commission.id, { toStatus: 'shipped' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'COMMISSION_INVALID_TRANSITION',
      details: { from: 'inquiry', to: 'shipped' },
    });
  });

  it('refuses -> quoted through the generic endpoint (requires the quote flow)', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createCommission();

    const res = await transition(agent, commission.id, { toStatus: 'quoted' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/quote flow/);
  });

  it('returns 403 COMMISSION_TRANSITION_FORBIDDEN when the owner tries an admin-only move', async () => {
    const { agent, user } = await loggedInAgent(app);
    const commission = await createQuotedCommission({ clientId: user.id, status: 'deposit_paid' });

    const res = await transition(agent, commission.id, { toStatus: 'in_progress' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMMISSION_TRANSITION_FORBIDDEN');
  });

  it("returns 403 for another client's commission and changes nothing", async () => {
    const { agent } = await loggedInAgent(app);
    const other = await createCommission();

    const res = await transition(agent, other.id, { toStatus: 'canceled' });

    expect(res.status).toBe(403);
    expect(await events(other.id)).toHaveLength(0);
    const { rows } = await pool.query('SELECT status FROM commissions WHERE id = $1', [other.id]);
    expect(rows[0].status).toBe('inquiry');
  });

  it('rejects an unknown status with 400 and a request without a session with 401', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createCommission();

    expect((await transition(agent, commission.id, { toStatus: 'teleported' })).status).toBe(400);
    expect((await transition(request(app), commission.id, { toStatus: 'canceled' })).status).toBe(
      401,
    );
  });

  it('handles two simultaneous changes safely: one wins, the other sees the new status', async () => {
    const { agent } = await loggedInAgent(app, { role: 'admin' });
    const commission = await createQuotedCommission({ status: 'deposit_paid' });

    const [a, b] = await Promise.all([
      transition(agent, commission.id, { toStatus: 'in_progress' }),
      transition(agent, commission.id, { toStatus: 'in_progress' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await events(commission.id)).filter((e) => e.to_status === 'in_progress')).toHaveLength(
      1,
    );
  });
});

describe('GET /api/v1/commissions/:id/events', () => {
  it("returns the owner's commission history in order", async () => {
    await createPricingRule({ size: 'test-size', medium: 'test-medium' });
    const { agent, user } = await loggedInAgent(app);
    const created = await agent
      .post('/api/v1/commissions')
      .set('Origin', TRUSTED_ORIGIN)
      .send(validRequest());
    await agent
      .post(`/api/v1/commissions/${created.body.data.id}/transitions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ toStatus: 'canceled' });

    const res = await agent.get(`/api/v1/commissions/${created.body.data.id}/events`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((e) => [e.fromStatus, e.toStatus])).toEqual([
      [null, 'inquiry'],
      ['inquiry', 'canceled'],
    ]);
    expect(res.body.data[0]).toMatchObject({ actorType: 'client', actorUserId: user.id });
  });

  it("returns 403 for another client's commission history", async () => {
    const { agent } = await loggedInAgent(app);
    const other = await createCommission({ clientId: (await createUser()).id });

    expect((await agent.get(`/api/v1/commissions/${other.id}/events`)).status).toBe(403);
  });

  it('returns 401 without a session', async () => {
    expect((await request(app).get('/api/v1/commissions/1/events')).status).toBe(401);
  });

  it('returns 400 for a bad id', async () => {
    const { agent } = await loggedInAgent(app);

    const res = await agent.get('/api/v1/commissions/abc/events');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('consistency with the database', () => {
  it('the state machine and the commission_status domain list the same statuses', async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'commission_status_check'`,
    );
    const dbStatuses = [...rows[0].def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

    expect(new Set(dbStatuses)).toEqual(new Set(STATUSES));
  });
});

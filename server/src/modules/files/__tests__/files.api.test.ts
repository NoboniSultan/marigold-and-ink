/**
 * A commission's files (milestone 10, ADR 0016): reference photos, previews, and final
 * files, against a fake storage. Every route: happy path, validation, 401, and 403.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../../../app.js';
import { pool } from '../../../db/pool.js';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import {
  createCommission,
  createCommissionEvent,
  createQuotedCommission,
} from '../../../../tests/factories/index.js';
import { TRUSTED_ORIGIN, loggedInAgent } from '../../../../tests/helpers/auth.js';
import { fakeStorage } from '../../../../tests/helpers/storage.ts';
import { PDF, jpegWithExif, png } from '../../../../tests/helpers/images.ts';
import { purgeExpiredFiles } from '../files.service.ts';
import { REFERENCE_LIMIT } from '../files.rules.ts';

let storage: ReturnType<typeof fakeStorage>;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  await truncateAllTables();
  storage = fakeStorage();
  app = createApp({
    adapters: { email: null, google: null, payments: null, storage: storage.storage },
  });
});

type Agent = request.Agent | ReturnType<typeof request>;

const send = (agent: Agent, path: string, body: Buffer, filename = 'photo.jpg') =>
  agent
    .post(path)
    .set('Origin', TRUSTED_ORIGIN)
    .set('Content-Type', 'application/octet-stream')
    .set('X-Filename', encodeURIComponent(filename))
    .send(body);

const reference = (agent: Agent, id: number, body: Buffer, filename?: string) =>
  send(agent, `/api/v1/commissions/${id}/files/references`, body, filename);
const preview = (agent: Agent, id: number, body: Buffer) =>
  send(agent, `/api/v1/admin/commissions/${id}/files/previews`, body, 'wip.png');
const final = (agent: Agent, id: number, body: Buffer, filename = 'Benito.pdf') =>
  send(agent, `/api/v1/admin/commissions/${id}/files/finals`, body, filename);

async function client() {
  const { agent, user } = await loggedInAgent(app);
  const commission = await createCommission({ clientId: user.id });
  return { agent, user, commission };
}
const admin = async () => (await loggedInAgent(app, { role: 'admin' })).agent;

const rows = async () =>
  (
    await pool.query(
      'SELECT kind, storage_key, original_filename, content_type, width, height FROM files ORDER BY id',
    )
  ).rows;

describe('POST /commissions/:id/files/references', () => {
  it('stores the photo upright, at most 2400 px, as JPEG, with no metadata left in it', async () => {
    const { agent, user, commission } = await client();

    const res = await reference(
      agent,
      commission.id,
      await jpegWithExif(3000, 2000),
      'Benito on the sofa.jpg',
    );

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'reference',
      originalFilename: 'Benito on the sofa.jpg',
      contentType: 'image/jpeg',
      width: 2400,
      height: 1600,
      url: expect.stringContaining('https://storage.test/commissions/'),
      downloadUrl: expect.stringContaining('download=Benito%20on%20the%20sofa.jpg'),
    });
    const [row] = await rows();
    expect(row.storage_key).toMatch(
      new RegExp(`^commissions/${commission.id}/reference/[0-9a-f-]{36}\\.jpg$`),
    );
    const stored = storage.objects.get(row.storage_key)!;
    expect(stored.contentType).toBe('image/jpeg');
    const meta = await sharp(stored.body).metadata();
    expect(meta.exif).toBeUndefined(); // the camera's details are gone
    expect(meta.width).toBe(2400);
    const { rows: owner } = await pool.query('SELECT uploaded_by_user_id FROM files');
    expect(Number(owner[0].uploaded_by_user_id)).toBe(user.id);
  });

  it('turns a PNG into a JPEG, and lets the admin add one too', async () => {
    const { commission } = await client();
    const res = await reference(await admin(), commission.id, await png());
    expect(res.status).toBe(201);
    expect(res.body.data.contentType).toBe('image/jpeg');
  });

  it(`allows ${REFERENCE_LIMIT} photos, then refuses more and keeps nothing of the extra one`, async () => {
    const { agent, commission } = await client();
    const photo = await png(20, 20);
    for (let i = 0; i < REFERENCE_LIMIT; i++) {
      expect((await reference(agent, commission.id, photo)).status).toBe(201);
    }

    const res = await reference(agent, commission.id, photo);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'REFERENCE_LIMIT',
      details: { limit: REFERENCE_LIMIT },
    });
    expect(storage.objects.size).toBe(REFERENCE_LIMIT);
  });

  it('refuses other file types, files that only look like images, and empty bodies (400)', async () => {
    const { agent, commission } = await client();
    const gif = Buffer.from('GIF89a........');
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not really')]);

    const wrongType = await reference(agent, commission.id, gif);
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    expect((await reference(agent, commission.id, PDF)).body.error.code).toBe(
      'UNSUPPORTED_FILE_TYPE',
    );
    expect((await reference(agent, commission.id, fakeJpeg)).body.error.code).toBe('NOT_AN_IMAGE');
    expect((await reference(agent, commission.id, Buffer.alloc(0))).body.error.code).toBe(
      'FILE_REQUIRED',
    );
    expect(storage.objects.size).toBe(0);
  });

  it('refuses a photo over 15 MB (400), and a body far over it before reading it (413)', async () => {
    const { agent, commission } = await client();
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(15 * 1024 * 1024)]);
    expect((await reference(agent, commission.id, big)).body.error.code).toBe('FILE_TOO_LARGE');

    const huge = Buffer.alloc(17 * 1024 * 1024);
    expect((await reference(agent, commission.id, huge)).status).toBe(413);
  });

  it('closes once work starts (409)', async () => {
    const { agent, commission } = await client();
    await pool.query(
      `UPDATE commissions SET status = 'in_progress', quoted_total_cents = 100, deposit_cents = 50, balance_cents = 50 WHERE id = $1`,
      [commission.id],
    );

    const res = await reference(agent, commission.id, await png());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REFERENCES_CLOSED');
  });

  it("is unavailable without storage (503), and needs the commission's own client (401, 403)", async () => {
    const { agent, commission } = await client();
    const photo = await png();
    expect((await reference(request(app), commission.id, photo)).status).toBe(401);
    expect((await reference((await loggedInAgent(app)).agent, commission.id, photo)).status).toBe(
      403,
    );

    app = createApp({ adapters: { email: null, google: null, payments: null } });
    const { agent: other, commission: theirs } = await client();
    const res = await reference(other, theirs.id, photo);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('FILES_UNAVAILABLE');
    expect(agent).toBeDefined();
  });

  it('removes the stored photo if the row is refused for another reason', async () => {
    const { agent, commission } = await client();
    // Ten already, added straight to the table (as if from another browser at once).
    for (let i = 0; i < REFERENCE_LIMIT; i++) {
      await pool.query(
        `INSERT INTO files (commission_id, uploaded_by_user_id, kind, storage_key, content_type, size_bytes)
         VALUES ($1, $2, 'reference', $3, 'image/jpeg', 1)`,
        [commission.id, commission.client_id, `elsewhere-${i}`],
      );
    }
    await reference(agent, commission.id, await png());
    expect(storage.objects.size).toBe(0);
  });
});

describe('admin uploads: previews and final files', () => {
  async function started() {
    const { agent, user, commission } = await client();
    await pool.query(
      `UPDATE commissions SET status = 'in_progress', quoted_total_cents = 10000, deposit_cents = 5000, balance_cents = 5000 WHERE id = $1`,
      [commission.id],
    );
    return { agent, user, commission };
  }

  it('watermarks a preview before storing it (the clean image is never kept)', async () => {
    const { commission } = await started();
    const original = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    const res = await preview(await admin(), commission.id, original);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'preview',
      contentType: 'image/jpeg',
      width: 800,
      height: 600,
    });
    const stored = [...storage.objects.values()][0]!;
    const stats = await sharp(stored.body).stats();
    // A plain white image comes back marked: some pixels are no longer white.
    expect(stats.channels[0]!.min).toBeLessThan(200);
  });

  it('stores a final file exactly as uploaded', async () => {
    const { commission } = await started();

    const res = await final(await admin(), commission.id, PDF);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      kind: 'final',
      contentType: 'application/pdf',
      url: null,
      width: null,
    });
    expect([...storage.objects.values()][0]!.body.equals(PDF)).toBe(true);
    expect((await rows())[0].original_filename).toBe('Benito.pdf');
  });

  it('refuses the wrong types (400), and before the deposit is paid (409)', async () => {
    const { commission } = await started();
    const agent = await admin();
    expect((await final(agent, commission.id, Buffer.from('GIF89a'))).body.error.code).toBe(
      'UNSUPPORTED_FILE_TYPE',
    );
    expect((await preview(agent, commission.id, PDF)).body.error.code).toBe(
      'UNSUPPORTED_FILE_TYPE',
    );

    const early = await createQuotedCommission();
    const res = await final(agent, early.id, PDF);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMMISSION_NOT_STARTED');
  });

  it('is for the admin only (401, 403)', async () => {
    const { agent, commission } = await started();
    expect((await preview(agent, commission.id, await png())).status).toBe(403);
    expect((await final(request(app), commission.id, PDF)).status).toBe(401);
  });
});

describe('GET /commissions/:id/files', () => {
  async function withFiles() {
    const { agent, user, commission } = await client();
    await reference(agent, commission.id, await png());
    await pool.query(
      `UPDATE commissions SET status = 'awaiting_final_payment', quoted_total_cents = 10000, deposit_cents = 5000, balance_cents = 5000 WHERE id = $1`,
      [commission.id],
    );
    const adminAgent = await admin();
    await preview(adminAgent, commission.id, await png());
    await final(adminAgent, commission.id, PDF);
    return { agent, user, commission, adminAgent };
  }

  it('shows the client their photos and previews, but final files only once paid in full', async () => {
    const { agent, commission } = await withFiles();

    const before = await agent.get(`/api/v1/commissions/${commission.id}/files`);
    expect(before.status).toBe(200);
    expect(before.body.data.map((f: { kind: string }) => f.kind)).toEqual(['reference', 'preview']);
    expect(before.body.meta).toMatchObject({
      filesEnabled: true,
      referencesOpen: false,
      referenceLimit: REFERENCE_LIMIT,
    });

    const paidAt = new Date('2026-06-01T12:00:00Z');
    await pool.query(`UPDATE commissions SET status = 'delivered' WHERE id = $1`, [commission.id]);
    await createCommissionEvent({
      commissionId: commission.id,
      toStatus: 'delivered',
      createdAt: paidAt,
    });

    const after = await agent.get(`/api/v1/commissions/${commission.id}/files`);
    const finalFile = after.body.data.find((f: { kind: string }) => f.kind === 'final');
    expect(finalFile).toMatchObject({
      downloadUrl: expect.stringContaining('download=Benito.pdf'),
      deleteAfter: '2027-06-01T12:00:00.000Z', // a year after full payment
    });
  });

  it('shows the admin everything, always', async () => {
    const { commission, adminAgent } = await withFiles();
    const res = await adminAgent.get(`/api/v1/commissions/${commission.id}/files`);
    expect(res.body.data.map((f: { kind: string }) => f.kind)).toEqual([
      'reference',
      'preview',
      'final',
    ]);
  });

  it('says uploads are off without storage, and needs the owner or admin (400, 401, 403)', async () => {
    const { agent, commission } = await client();
    app = createApp({ adapters: { email: null, google: null, payments: null } });
    const off = await (
      await loggedInAgent(app, { role: 'admin' })
    ).agent.get(`/api/v1/commissions/${commission.id}/files`);
    expect(off.body).toEqual({ data: [], meta: expect.objectContaining({ filesEnabled: false }) });

    expect((await request(app).get(`/api/v1/commissions/${commission.id}/files`)).status).toBe(401);
    expect(
      (await (await loggedInAgent(app)).agent.get(`/api/v1/commissions/${commission.id}/files`))
        .status,
    ).toBe(403);
    expect((await agent.get('/api/v1/commissions/abc/files')).status).toBe(400);
  });
});

describe('DELETE /commissions/:id/files/:fileId', () => {
  const remove = (agent: Agent, id: number, fileId: number) =>
    agent.delete(`/api/v1/commissions/${id}/files/${fileId}`).set('Origin', TRUSTED_ORIGIN);

  it('lets the client remove their photo before work starts, from storage too', async () => {
    const { agent, commission } = await client();
    const { body } = await reference(agent, commission.id, await png());

    expect((await remove(agent, commission.id, body.data.id)).status).toBe(204);
    expect(await rows()).toEqual([]);
    expect(storage.objects.size).toBe(0);
  });

  it('keeps the client away from previews (403) and from changes once work starts (409)', async () => {
    const { agent, commission } = await client();
    const { body } = await reference(agent, commission.id, await png());
    await pool.query(
      `UPDATE commissions SET status = 'in_progress', quoted_total_cents = 10000, deposit_cents = 5000, balance_cents = 5000 WHERE id = $1`,
      [commission.id],
    );
    const { body: wip } = await preview(await admin(), commission.id, await png());

    expect((await remove(agent, commission.id, wip.data.id)).status).toBe(403);
    expect((await remove(agent, commission.id, body.data.id)).body.error.code).toBe(
      'REFERENCES_CLOSED',
    );
    expect((await remove(await admin(), commission.id, wip.data.id)).status).toBe(204);
  });

  it("404s a file that isn't on this commission, and needs a signed-in user (401)", async () => {
    const { agent, commission } = await client();
    const { body } = await reference(agent, commission.id, await png());
    const { commission: other } = await client();

    expect((await remove(await admin(), other.id, body.data.id)).status).toBe(404);
    expect((await remove(await admin(), commission.id, 999999)).status).toBe(404);
    expect((await remove(request(app), commission.id, body.data.id)).status).toBe(401);
  });

  it('keeps the row when storage fails, so the removal can be tried again', async () => {
    const { agent, commission } = await client();
    const { body } = await reference(agent, commission.id, await png());
    storage.failNext.remove = true;

    expect((await remove(agent, commission.id, body.data.id)).status).toBe(500);
    expect(await rows()).toHaveLength(1);
  });
});

describe('purgeExpiredFiles', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2027-01-01T00:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

  async function fileOn(commissionId: number, kind: string, userId: number) {
    const key = `commissions/${commissionId}/${kind}/${Math.random()}.jpg`;
    storage.objects.set(key, { body: Buffer.from('x'), contentType: 'image/jpeg' });
    await pool.query(
      `INSERT INTO files (commission_id, uploaded_by_user_id, kind, storage_key, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, 'image/jpeg', 1)`,
      [commissionId, userId, kind, key],
    );
    return key;
  }

  async function ended(status: string, at: Date) {
    const commission = await createCommission({
      status: status === 'canceled' ? 'canceled' : status,
      ...(status === 'canceled'
        ? {}
        : { quotedTotalCents: 100, depositCents: 50, balanceCents: 50 }),
    });
    await createCommissionEvent({ commissionId: commission.id, toStatus: status, createdAt: at });
    return commission;
  }

  it('deletes reference photos 90 days after the commission ends, and deliverables a year after payment', async () => {
    const old = await ended('canceled', daysAgo(91));
    const recent = await ended('canceled', daysAgo(10));
    const active = await createCommission();
    const paid = await createQuotedCommission({ status: 'delivered' });
    await createCommissionEvent({
      commissionId: paid.id,
      toStatus: 'delivered',
      createdAt: daysAgo(366),
    });
    const paidRecently = await createQuotedCommission({ status: 'delivered' });
    await createCommissionEvent({
      commissionId: paidRecently.id,
      toStatus: 'delivered',
      createdAt: daysAgo(30),
    });

    const goes = [
      await fileOn(old.id, 'reference', old.client_id),
      await fileOn(paid.id, 'final', paid.client_id),
      await fileOn(paid.id, 'preview', paid.client_id),
    ];
    const stays = [
      await fileOn(recent.id, 'reference', recent.client_id),
      await fileOn(active.id, 'reference', active.client_id),
      await fileOn(paidRecently.id, 'final', paidRecently.client_id),
      await fileOn(paidRecently.id, 'reference', paidRecently.client_id), // not ended yet
    ];

    expect(await purgeExpiredFiles(storage.storage, now)).toBe(3);

    for (const key of goes) expect(storage.objects.has(key)).toBe(false);
    for (const key of stays) expect(storage.objects.has(key)).toBe(true);
    expect((await rows()).map((r) => r.storage_key).sort()).toEqual([...stays].sort());
  });

  it('does nothing without storage or with nothing to delete, and keeps rows if storage fails', async () => {
    expect(await purgeExpiredFiles(null, now)).toBe(0);
    expect(await purgeExpiredFiles(storage.storage, now)).toBe(0);

    const old = await ended('canceled', daysAgo(100));
    await fileOn(old.id, 'reference', old.client_id);
    storage.failNext.remove = true;
    expect(await purgeExpiredFiles(storage.storage, now)).toBe(0);
    expect(await rows()).toHaveLength(1);
  });
});

describe('account deletion', () => {
  it("removes the client's reference photos, from storage too", async () => {
    const { agent, user, commission } = await client();
    await reference(agent, commission.id, await png());

    const res = await agent
      .delete('/api/v1/users/me')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ password: user.password });

    expect(res.status).toBe(204);
    expect(await rows()).toEqual([]);
    expect(storage.objects.size).toBe(0);
  });
});

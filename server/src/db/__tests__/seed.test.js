import { describe, it, expect, beforeEach } from 'vitest';
import { pool } from '../pool.js';
import { seedAdmin } from '../seeds/admin.js';
import { verifyPassword } from '../../lib/password.js';
import { truncateAllTables } from '../../../tests/setup/database.js';
import { createUserWithPassword } from '../../../tests/factories/index.js';

beforeEach(truncateAllTables);

const env = {
  ADMIN_EMAIL: 'Owner@Example.com',
  ADMIN_PASSWORD: 'a strong admin password',
};

async function findUser(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0];
}

describe('seedAdmin', () => {
  it('creates an admin from environment variables, with a normalized email', async () => {
    const result = await seedAdmin(env);

    expect(result).toMatchObject({ skipped: false, created: true });
    const admin = await findUser('owner@example.com');
    expect(admin).toMatchObject({
      email: 'owner@example.com',
      role: 'admin',
      display_name: 'Admin',
    });
    expect(await verifyPassword(env.ADMIN_PASSWORD, admin.password_hash)).toBe(true);
  });

  it('is idempotent: a second run creates nothing', async () => {
    await seedAdmin(env);
    const second = await seedAdmin(env);

    expect(second.created).toBe(false);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(1);
  });

  it('promotes an existing account without changing its password', async () => {
    const existing = await createUserWithPassword({ email: 'owner@example.com' });

    const result = await seedAdmin(env);

    expect(result.created).toBe(false);
    const admin = await findUser('owner@example.com');
    expect(admin.role).toBe('admin');
    expect(await verifyPassword(existing.password, admin.password_hash)).toBe(true);
  });

  it('skips when ADMIN_EMAIL is not set', async () => {
    expect(await seedAdmin({})).toEqual({ skipped: true, reason: 'ADMIN_EMAIL is not set' });
  });

  it('refuses a password that fails the policy', async () => {
    await expect(seedAdmin({ ...env, ADMIN_PASSWORD: 'short' })).rejects.toThrow(/ADMIN_PASSWORD/);
  });
});

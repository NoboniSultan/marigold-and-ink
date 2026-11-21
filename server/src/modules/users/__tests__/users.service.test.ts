import { describe, it, expect, beforeEach } from 'vitest';
import { truncateAllTables } from '../../../../tests/setup/database.js';
import { createUser } from '../../../../tests/factories/index.js';
import * as usersService from '../users.service.ts';

beforeEach(truncateAllTables);

const newUser = { email: 'ana@example.com', passwordHash: null, displayName: 'Ana' };

describe('users.service', () => {
  it('turns a duplicate email into 409 EMAIL_TAKEN (two sign-ups racing hit the database constraint)', async () => {
    await usersService.createUser(newUser);

    await expect(
      usersService.createUser({ ...newUser, email: 'ANA@example.com' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_TAKEN',
    });
  });

  it('only claims or clears accounts that are still unverified, and says so loudly otherwise', async () => {
    const verified = await createUser();

    await expect(
      usersService.claimUnverified(verified.id, { passwordHash: 'x', displayName: 'X' }),
    ).rejects.toThrow(/already verified/);
    await expect(usersService.verifyAndClearPassword(verified.id)).rejects.toThrow(
      /already verified/,
    );
  });
});

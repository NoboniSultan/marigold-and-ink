import { describe, it, expect } from 'vitest';
import { canAccessOwnedResource, assertCanAccessOwnedResource } from '../authorization.js';
import { ForbiddenError } from '../../errors/index.js';
import { toLimitOffset, toPageMeta, paginationQuery } from '../pagination.js';

const client = { id: 1, role: 'client' };
const admin = { id: 2, role: 'admin' };

describe('canAccessOwnedResource', () => {
  it.each([
    ['a client, their own resource', client, 1, true],
    ["a client, someone else's resource", client, 99, false],
    ["an admin, someone else's resource", admin, 99, true],
    ['no user', null, 1, false],
  ])('%s -> %s', (_label, user, ownerId, expected) => {
    expect(canAccessOwnedResource(user, ownerId)).toBe(expected);
  });

  it('does not treat a string ID as equal to a numeric owner ID', () => {
    // Guards the int8 type parser in db/pool.js: IDs must be numbers end to end.
    expect(canAccessOwnedResource({ id: '1', role: 'client' }, 1)).toBe(false);
  });

  it('assert throws ForbiddenError when access is denied', () => {
    expect(() => assertCanAccessOwnedResource(client, 99)).toThrow(ForbiddenError);
    expect(() => assertCanAccessOwnedResource(client, 1)).not.toThrow();
  });
});

describe('pagination helpers', () => {
  it('defaults to page 1 of 20', () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('converts a page to LIMIT/OFFSET', () => {
    expect(toLimitOffset({ page: 3, pageSize: 20 })).toEqual({ limit: 20, offset: 40 });
  });

  it('builds the list meta block', () => {
    expect(toPageMeta({ page: 2, pageSize: 10 }, 35)).toEqual({ page: 2, pageSize: 10, total: 35 });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { ApiError, fieldErrors, formMessage, request } from './client.ts';
import { mockApi } from '../test/utils.tsx';

describe('request', () => {
  it('sends JSON with the session cookie and returns the body', async () => {
    const calls = mockApi(() => ({ body: { data: { ok: true } } }));

    const result = await request('/things', {
      method: 'POST',
      body: { a: 1 },
      query: { page: 2, q: '', tag: undefined },
    });

    expect(result).toEqual({ data: { ok: true } });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/things', body: { a: 1 } });
    // Empty and undefined query values are left out.
    expect(calls[0]!.params.toString()).toBe('page=2');
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.credentials).toBe('same-origin');
  });

  it('returns undefined for 204 No Content', async () => {
    mockApi(() => ({ status: 204 }));
    await expect(request('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it("throws ApiError with the server's code, message, and details", async () => {
    mockApi(() => ({
      status: 409,
      body: { error: { code: 'EMAIL_TAKEN', message: 'Email in use', details: { x: 1 } } },
    }));

    const error = await request('/auth/register').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'EMAIL_TAKEN', message: 'Email in use' });
  });

  it('turns a network failure into a readable NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('/artworks')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('copes with an error response that is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    await expect(request('/artworks')).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
      status: 502,
    });
  });
});

describe('fieldErrors and formMessage', () => {
  const validation = new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
    { location: 'body', path: 'email', message: 'must be a valid email' },
    { location: 'body', path: 'email', message: 'second problem' },
    { location: 'body', path: 'password', message: 'too short' },
  ]);

  it('maps the first problem per field', () => {
    expect(fieldErrors(validation)).toEqual({
      email: 'must be a valid email',
      password: 'too short',
    });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });

  it('explains validation errors generally and passes other messages through', () => {
    expect(formMessage(validation)).toBe('Please check the highlighted fields.');
    expect(formMessage(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'))).toBe(
      'Invalid email or password',
    );
    expect(formMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});

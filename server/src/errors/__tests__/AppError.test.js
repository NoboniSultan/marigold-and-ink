import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  RateLimitError,
  ServiceUnavailableError,
} from '../index.js';

describe('AppError subclasses', () => {
  it.each([
    [ValidationError, 400, 'VALIDATION_ERROR'],
    [UnauthorizedError, 401, 'UNAUTHENTICATED'],
    [ForbiddenError, 403, 'FORBIDDEN'],
    [NotFoundError, 404, 'NOT_FOUND'],
    [ConflictError, 409, 'CONFLICT'],
    [BusinessRuleError, 422, 'BUSINESS_RULE_VIOLATION'],
    [RateLimitError, 429, 'RATE_LIMITED'],
    [ServiceUnavailableError, 503, 'SERVICE_UNAVAILABLE'],
  ])('%o has status %i and default code %s', (ErrorClass, status, code) => {
    const err = new ErrorClass();

    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.name).toBe(ErrorClass.name);
    expect(err.message).toEqual(expect.any(String));
  });

  it('accepts a specific code, details, and cause', () => {
    const cause = new Error('underlying');
    const err = new ConflictError('Invalid transition', {
      code: 'COMMISSION_INVALID_TRANSITION',
      details: { from: 'inquiry', to: 'shipped' },
      cause,
    });

    expect(err.status).toBe(409);
    expect(err.code).toBe('COMMISSION_INVALID_TRANSITION');
    expect(err.details).toEqual({ from: 'inquiry', to: 'shipped' });
    expect(err.cause).toBe(cause);
  });

  it('defaults the base class to a 500', () => {
    const err = new AppError('boom');

    expect(err.status).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
  });
});

/**
 * Base class for every error the API deliberately returns to a client.
 * The central error handler turns it into:
 *   { "error": { "code", "message", "details" } } with `status` as the HTTP status.
 * Anything that is NOT an AppError is treated as an unexpected 500.
 *
 * Subclasses set the status and a default code. Callers can pass a more specific code,
 * e.g. new ConflictError('...', { code: 'COMMISSION_INVALID_TRANSITION' }).
 */

/** Options every subclass accepts. `details` is sent to the client, so keep it safe to show. */
export interface AppErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  // Declared as fields (not constructor parameter properties, which Node's type stripping
  // can't erase) and assigned in the constructor.
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    message: string,
    {
      status = 500,
      code = 'INTERNAL_ERROR',
      details,
      cause,
    }: AppErrorOptions & { status?: number } = {},
  ) {
    super(message, { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(
    message = 'Invalid request',
    { code = 'VALIDATION_ERROR', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 400, code, ...rest });
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message = 'Authentication required',
    { code = 'UNAUTHENTICATED', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 401, code, ...rest });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have access to this resource',
    { code = 'FORBIDDEN', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 403, code, ...rest });
  }
}

export class NotFoundError extends AppError {
  constructor(
    message = 'Resource not found',
    { code = 'NOT_FOUND', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 404, code, ...rest });
  }
}

export class ConflictError extends AppError {
  constructor(
    message = 'Request conflicts with the current state',
    { code = 'CONFLICT', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 409, code, ...rest });
  }
}

export class BusinessRuleError extends AppError {
  constructor(
    message = 'Request violates a business rule',
    { code = 'BUSINESS_RULE_VIOLATION', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 422, code, ...rest });
  }
}

export class RateLimitError extends AppError {
  constructor(
    message = 'Too many requests, please try again later',
    { code = 'RATE_LIMITED', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 429, code, ...rest });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Service temporarily unavailable',
    { code = 'SERVICE_UNAVAILABLE', ...rest }: AppErrorOptions = {},
  ) {
    super(message, { status: 503, code, ...rest });
  }
}

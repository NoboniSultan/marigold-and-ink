import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/dev',
  AUTH_SECRET: 'x'.repeat(32),
  CORS_ORIGINS: 'http://localhost:5173, https://example.com',
  DEPOSIT_PERCENT: '40', // test values only, not business values
  COMMISSION_REVISION_LIMIT: '3',
};

describe('loadConfig', () => {
  it('reads the business settings', () => {
    const config = loadConfig({ ...validEnv, DEPOSIT_PERCENT: '33.33' });

    expect(config.depositPercent).toBe(33.33);
    expect(config.commissionRevisionLimit).toBe(3);
  });

  it('refuses to start without the business settings (no invented defaults)', () => {
    const { DEPOSIT_PERCENT: _d, COMMISSION_REVISION_LIMIT: _r, ...withoutBusiness } = validEnv;

    expect(() => loadConfig(withoutBusiness)).toThrow(
      /DEPOSIT_PERCENT[\s\S]*COMMISSION_REVISION_LIMIT/,
    );
  });

  it.each(['101', '-1', '12.345'])('rejects DEPOSIT_PERCENT=%s', (value) => {
    expect(() => loadConfig({ ...validEnv, DEPOSIT_PERCENT: value })).toThrow(/DEPOSIT_PERCENT/);
  });

  it('parses a valid environment into a typed config', () => {
    const config = loadConfig(validEnv);

    expect(config).toMatchObject({
      nodeEnv: 'development',
      isProduction: false,
      port: 4000,
      logLevel: 'info',
      databaseUrl: validEnv.DATABASE_URL,
      corsOrigins: ['http://localhost:5173', 'https://example.com'],
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('applies the approved security defaults', () => {
    const config = loadConfig(validEnv);

    expect(config.trustProxy).toBe(0);
    expect(config.bcryptRounds).toBe(12);
    expect(config.sessionMaxAgeMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.rateLimits).toEqual({
      login: { limit: 10, windowMs: 15 * 60_000 },
      register: { limit: 5, windowMs: 60 * 60_000 },
    });
  });

  it('uses TEST_DATABASE_URL when NODE_ENV is test', () => {
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgres://u:p@localhost:5433/app_test',
    });

    expect(config.databaseUrl).toBe('postgres://u:p@localhost:5433/app_test');
  });

  it('requires TEST_DATABASE_URL in test mode, even if DATABASE_URL is set', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'test' })).toThrow(/TEST_DATABASE_URL/);
  });

  it('lists every invalid variable in one readable message', () => {
    let error;
    try {
      loadConfig({ NODE_ENV: 'development', AUTH_SECRET: 'short', CORS_ORIGINS: 'not-a-url' });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toMatch(/AUTH_SECRET/);
    expect(error.message).toMatch(/CORS_ORIGINS/);
    expect(error.message).toMatch(/DATABASE_URL/);
  });

  it('treats empty strings as missing', () => {
    expect(() => loadConfig({ ...validEnv, AUTH_SECRET: '' })).toThrow(/AUTH_SECRET/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });
});

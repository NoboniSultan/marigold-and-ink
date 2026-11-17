import { describe, it, expect } from 'vitest';
import { loadConfig, ConfigError } from '../env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/dev',
  AUTH_SECRET: 'x'.repeat(32),
  CORS_ORIGINS: 'http://localhost:5173, https://example.com',
};

describe('loadConfig', () => {
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

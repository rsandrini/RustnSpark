import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';
import { envSchema, validateEnv } from './env.schema.js';

const SECRET_A = 'a'.repeat(32);
const SECRET_B = 'b'.repeat(32);

function validSource(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3100',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: 'http://localhost:5173,https://game.example.com',
    JWT_ACCESS_SECRET: SECRET_A,
    COOKIE_SECRET: SECRET_B,
    ARGON2_MEMORY_KIB: '19456',
    ARGON2_TIME_COST: '2',
    ARGON2_PARALLELISM: '1',
  };
}

function errorOf(source: Record<string, string | undefined>): Error {
  try {
    validateEnv(source);
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected validateEnv to throw');
}

describe('validateEnv', () => {
  it('returns a typed, parsed configuration for a valid source', () => {
    expect(validateEnv(validSource())).toEqual({
      NODE_ENV: 'test',
      PORT: 3100,
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: ['http://localhost:5173', 'https://game.example.com'],
      JWT_ACCESS_SECRET: SECRET_A,
      COOKIE_SECRET: SECRET_B,
      ARGON2_MEMORY_KIB: 19456,
      ARGON2_TIME_COST: 2,
      ARGON2_PARALLELISM: 1,
      RECONCILE_INTERVAL_MS: 30000,
      WEB_URL: 'http://localhost:3000',
    });
  });

  it('ignores variables the schema does not declare', () => {
    const env = validateEnv({ ...validSource(), PATH: '/usr/bin', HOME: '/root' });
    expect(env).not.toHaveProperty('PATH');
  });

  it('defaults PORT to 3000', () => {
    const source: Record<string, string | undefined> = validSource();
    delete source.PORT;
    expect(validateEnv(source).PORT).toBe(3000);
  });

  it.each([
    ['ARGON2_MEMORY_KIB', 19456],
    ['ARGON2_TIME_COST', 2],
    ['ARGON2_PARALLELISM', 1],
    ['RECONCILE_INTERVAL_MS', 30000],
  ])('defaults %s to its documented default %p', (key, defaultValue) => {
    const source: Record<string, string | undefined> = validSource();
    delete source[key];
    expect(validateEnv(source)[key as keyof ReturnType<typeof validateEnv>]).toBe(defaultValue);
  });

  it('defaults WEB_URL to http://localhost:3000', () => {
    const source: Record<string, string | undefined> = validSource();
    delete source.WEB_URL;
    expect(validateEnv(source).WEB_URL).toBe('http://localhost:3000');
  });

  it.each(['not a url', ''])('refuses an invalid WEB_URL (%p)', (value) => {
    expect(errorOf({ ...validSource(), WEB_URL: value }).message).toContain('WEB_URL');
  });

  it('treats Resend email variables as optional', () => {
    expect(validateEnv(validSource()).RESEND_API_KEY).toBeUndefined();
    expect(validateEnv(validSource()).RESEND_FROM_EMAIL).toBeUndefined();
    expect(validateEnv(validSource()).RESEND_FROM_NAME).toBeUndefined();
    const withEmail = validateEnv({
      ...validSource(),
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'noreply@example.com',
      RESEND_FROM_NAME: 'RustnSpark',
    });
    expect(withEmail.RESEND_API_KEY).toBe('re_test');
    expect(withEmail.RESEND_FROM_EMAIL).toBe('noreply@example.com');
    expect(withEmail.RESEND_FROM_NAME).toBe('RustnSpark');
  });

  it('accepts an empty RESEND_API_KEY as "email disabled"', () => {
    expect(validateEnv({ ...validSource(), RESEND_API_KEY: '' }).RESEND_API_KEY).toBe('');
  });

  it.each(['ARGON2_MEMORY_KIB', 'ARGON2_TIME_COST', 'ARGON2_PARALLELISM', 'RECONCILE_INTERVAL_MS'])(
    'refuses a non-integer or non-positive %s',
    (key) => {
      expect(errorOf({ ...validSource(), [key]: 'abc' }).message).toContain(key);
      expect(errorOf({ ...validSource(), [key]: '0' }).message).toContain(key);
      expect(errorOf({ ...validSource(), [key]: '-1' }).message).toContain(key);
      expect(errorOf({ ...validSource(), [key]: '1.5' }).message).toContain(key);
    },
  );

  it.each([
    'NODE_ENV',
    'DATABASE_URL',
    'REDIS_URL',
    'CORS_ORIGINS',
    'JWT_ACCESS_SECRET',
    'COOKIE_SECRET',
  ])('refuses a missing %s and names it in the error', (key) => {
    const source: Record<string, string | undefined> = validSource();
    delete source[key];
    expect(errorOf(source).message).toContain(key);
  });

  it.each([
    ['NODE_ENV', 'staging'],
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PORT', '30.5'],
    ['DATABASE_URL', 'not a url'],
    ['DATABASE_URL', 'mysql://localhost/db'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['CORS_ORIGINS', ''],
    ['CORS_ORIGINS', '*'],
    ['CORS_ORIGINS', 'http://localhost:5173/'],
    ['CORS_ORIGINS', 'http://localhost:5173,,'],
    ['CORS_ORIGINS', 'localhost:5173'],
  ])('refuses an invalid %s (%p)', (key, value) => {
    expect(errorOf({ ...validSource(), [key]: value }).message).toContain(key);
  });

  it.each(['JWT_ACCESS_SECRET', 'COOKIE_SECRET'])(
    'refuses an empty or short %s (minimum 32 characters)',
    (key) => {
      expect(errorOf({ ...validSource(), [key]: '' }).message).toContain(key);
      expect(errorOf({ ...validSource(), [key]: 'x'.repeat(31) }).message).toContain(key);
      expect(validateEnv({ ...validSource(), [key]: 'x'.repeat(32) })).toHaveProperty(key);
    },
  );

  it('reports every problem at once', () => {
    const message = errorOf({ NODE_ENV: 'test' }).message;
    for (const key of [
      'DATABASE_URL',
      'REDIS_URL',
      'CORS_ORIGINS',
      'JWT_ACCESS_SECRET',
      'COOKIE_SECRET',
    ]) {
      expect(message).toContain(key);
    }
  });

  it('never echoes a rejected secret value in the error', () => {
    const leaked = 'super-secret-too-short';
    const message = errorOf({ ...validSource(), JWT_ACCESS_SECRET: leaked }).message;
    expect(message).toContain('JWT_ACCESS_SECRET');
    expect(message).not.toContain(leaked);
  });
});

describe('.env.example', () => {
  it('lists every variable of the schema, and only those', () => {
    const file = readFileSync(new URL('../../../../../.env.example', import.meta.url), 'utf8');
    const listed = file
      .split('\n')
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => line.slice(0, line.indexOf('=')))
      .sort();
    expect(listed).toEqual(Object.keys(envSchema.shape).sort());
  });
});

import { describe, expect, it } from '@jest/globals';
import { parseOptions } from '@node-rs/argon2';
import { EnvService, type Env } from '../common/env/env.module.js';
import { PasswordService } from './password.service.js';

// See password.service.ts: `Algorithm` is an ambient const enum, unusable under isolatedModules.
const ARGON2ID = 2;

function envWith(overrides: Partial<Env> = {}): EnvService {
  const values: Env = {
    NODE_ENV: 'test',
    PORT: 3100,
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGINS: ['http://localhost:5173'],
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    COOKIE_SECRET: 'b'.repeat(32),
    ARGON2_MEMORY_KIB: 4096,
    ARGON2_TIME_COST: 1,
    ARGON2_PARALLELISM: 1,
    ...overrides,
  };
  return new EnvService(values);
}

describe('PasswordService', () => {
  it('hashes a password as an Argon2id PHC string', async () => {
    const service = new PasswordService(envWith());

    const hashed = await service.hash('correct horse battery staple');

    expect(hashed).toMatch(/^\$argon2id\$/);
  });

  it('produces a different hash each time (random salt)', async () => {
    const service = new PasswordService(envWith());

    const [first, second] = await Promise.all([
      service.hash('correct horse battery staple'),
      service.hash('correct horse battery staple'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verify() accepts the matching plaintext', async () => {
    const service = new PasswordService(envWith());
    const hashed = await service.hash('correct horse battery staple');

    await expect(service.verify(hashed, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('verify() rejects a wrong plaintext', async () => {
    const service = new PasswordService(envWith());
    const hashed = await service.hash('correct horse battery staple');

    await expect(service.verify(hashed, 'wrong password')).resolves.toBe(false);
  });

  it('hashes with the env-configured Argon2id cost parameters', async () => {
    const service = new PasswordService(
      envWith({ ARGON2_MEMORY_KIB: 8192, ARGON2_TIME_COST: 3, ARGON2_PARALLELISM: 2 }),
    );

    const hashed = await service.hash('correct horse battery staple');
    const options = parseOptions(hashed);

    expect(options.algorithm).toBe(ARGON2ID);
    expect(options.memoryCost).toBe(8192);
    expect(options.timeCost).toBe(3);
    expect(options.parallelism).toBe(2);
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { EnvService, type Env } from '../common/env/env.module.js';
import { InvalidAccessTokenError, TokenService } from './token.service.js';

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

const CLAIMS = { accountId: 'acc-1', playerId: 'player-1', role: 'PLAYER' as const };

describe('TokenService', () => {
  it('signs an access token carrying sub, pid and role', async () => {
    const service = new TokenService(envWith());

    const token = await service.signAccessToken(CLAIMS);
    const verified = await service.verifyAccessToken(token);

    expect(verified).toEqual(CLAIMS);
  });

  it('signs with a 15-minute (900s) expiration', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    try {
      const service = new TokenService(envWith());
      const token = await service.signAccessToken(CLAIMS);
      const payloadB64 = token.split('.')[1];
      if (!payloadB64) throw new Error('signed token is missing its payload segment');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
        iat: number;
        exp: number;
      };

      expect(payload.exp - payload.iat).toBe(900);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a token signed with a different secret', async () => {
    const signer = new TokenService(envWith());
    const verifier = new TokenService(envWith({ JWT_ACCESS_SECRET: 'c'.repeat(32) }));
    const token = await signer.signAccessToken(CLAIMS);

    await expect(verifier.verifyAccessToken(token)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects an expired token', async () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const service = new TokenService(envWith());
    const token = await service.signAccessToken(CLAIMS);

    jest.setSystemTime(new Date('2026-01-01T00:15:01.000Z')); // 1s past the 900s TTL
    await expect(service.verifyAccessToken(token)).rejects.toThrow(InvalidAccessTokenError);
    jest.useRealTimers();
  });

  it('rejects a malformed token', async () => {
    const service = new TokenService(envWith());

    await expect(service.verifyAccessToken('not-a-jwt')).rejects.toThrow(InvalidAccessTokenError);
  });
});

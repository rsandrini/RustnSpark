import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import pino from 'pino';
import { createPinoHttpOptions } from '../../src/common/logging/pino.config.js';
import { EnvService, type Env } from '../../src/common/env/env.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { RefreshTokenService } from '../../src/auth/refresh-token.service.js';
import { resetDatabase } from '../support/test-db.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://rustandspark:rustandspark@127.0.0.1:5433/rustandspark_test';

function makeEnv(overrides: Partial<Env> = {}): EnvService {
  const values: Env = {
    NODE_ENV: 'test',
    PORT: 3100,
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380',
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

// Captures every line a real, production-configured pino instance writes, so the test asserts on
// what actually left the redaction pipeline (createPinoHttpOptions, S1.5), not on a hand-stubbed
// logger. The plan's log-safety acceptance is about that pipeline, so this test does not reimplement
// redaction; it reuses pino.config.ts exactly as main.ts wires it for `NODE_ENV=production`.
function captureLog(): { logger: pino.Logger; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'));
      callback();
    },
  });
  const logger = pino(createPinoHttpOptions('production'), stream);
  return { logger, output: () => chunks.join('') };
}

// Exercises real password-hash and refresh-token sign/rotate flows (no DB mocks), then logs the
// exact shapes pino-http produces for real HTTP traffic once S2.3 wires controllers:
// req.body.{password,token}, req.headers.{authorization,cookie} (the refresh cookie, D5) and
// res.headers['set-cookie']. Every one of those paths is in pino.config.ts's REDACT_PATHS.
describe('auth secrets never reach log output (plan acceptance)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const prisma = new PrismaService(makeEnv());
  const passwordService = new PasswordService(makeEnv());
  const tokenService = new TokenService(makeEnv());
  const refreshTokenService = new RefreshTokenService(prisma, makeEnv());
  let accountId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        email: `log-safety-${randomUUID()}@example.com`,
        passwordHash: 'irrelevant-for-this-suite',
      },
    });
    accountId = account.id;
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('redacts a real password through a password-hash flow', async () => {
    const plainPassword = 'S3cur3-Passw0rd!';
    const { logger, output } = captureLog();

    await passwordService.hash(plainPassword);
    logger.info({ req: { body: { password: plainPassword } } }, 'account registration attempt');

    expect(output()).not.toContain(plainPassword);
    expect(output()).toContain('[REDACTED]');
  });

  it('redacts a real access token and a real refresh token through a sign/rotate flow', async () => {
    const { logger, output } = captureLog();

    const accessToken = await tokenService.signAccessToken({
      accountId,
      playerId: randomUUID(),
      role: 'PLAYER',
    });
    const issued = await refreshTokenService.issue(accountId);
    const rotated = await refreshTokenService.rotate(issued.token);

    logger.info(
      {
        req: { headers: { authorization: `Bearer ${accessToken}`, cookie: `rid=${issued.token}` } },
      },
      'authenticated request',
    );
    logger.info(
      { res: { headers: { 'set-cookie': [`rid=${rotated.token}; HttpOnly; Secure`] } } },
      'refresh token rotated',
    );

    const captured = output();
    expect(captured).not.toContain(accessToken);
    expect(captured).not.toContain(issued.token);
    expect(captured).not.toContain(rotated.token);
    expect(captured).toContain('[REDACTED]');
  });
});

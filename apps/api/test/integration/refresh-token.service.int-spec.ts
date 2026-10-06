import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { EnvService, type Env } from '../../src/common/env/env.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import {
  RefreshTokenExpiredError,
  RefreshTokenNotFoundError,
  RefreshTokenReusedError,
  RefreshTokenService,
} from '../../src/auth/refresh-token.service.js';
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
    RECONCILE_INTERVAL_MS: 30000,
    WEB_URL: 'http://localhost:3000',
    ...overrides,
  };
  return new EnvService(values);
}

// Targets the compose `test` profile's tmpfs Postgres (D9): run
// `docker compose --profile test up -d --wait postgres-test` before `pnpm --filter api test:int`.
// No DB mocks (global constraint): rotation and reuse-revocation are transactional behaviors that
// only a real Postgres round trip can prove.
describe('RefreshTokenService against postgres-test', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const prisma = new PrismaService(makeEnv());
  const service = new RefreshTokenService(prisma, makeEnv());
  let accountId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test'; // resetDatabase() refuses to truncate otherwise
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    const account = await prisma.account.create({
      data: {
        email: `refresh-${randomUUID()}@example.com`,
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

  it('issues a token stored only as an HMAC-SHA-256 hash, never the raw value', async () => {
    const issued = await service.issue(accountId);

    const row = await prisma.refreshToken.findFirstOrThrow({
      where: { familyId: issued.familyId },
    });
    expect(row.tokenHash).not.toBe(issued.token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/); // hex SHA-256 digest
    expect(row.accountId).toBe(accountId);
    expect(row.revokedAt).toBeNull();
  });

  it('rotate() revokes the used token and chains a new one into the same family', async () => {
    const issued = await service.issue(accountId);

    const rotated = await service.rotate(issued.token);

    expect(rotated.familyId).toBe(issued.familyId);
    expect(rotated.token).not.toBe(issued.token);

    const rows = await prisma.refreshToken.findMany({ where: { familyId: issued.familyId } });
    expect(rows).toHaveLength(2);
    const original = rows.find((row) => row.revokedAt !== null);
    const next = rows.find((row) => row.revokedAt === null);
    expect(original?.replacedById).toBe(next?.id);
  });

  it('rotate() resets the sliding 30-day expiry on the new token', async () => {
    const issued = await service.issue(accountId);

    const rotated = await service.rotate(issued.token);

    expect(rotated.expiresAt.getTime()).toBeGreaterThanOrEqual(issued.expiresAt.getTime());
  });

  it('rejects a rotate() for a token that never existed', async () => {
    await expect(service.rotate('this-token-was-never-issued')).rejects.toBeInstanceOf(
      RefreshTokenNotFoundError,
    );
  });

  it('reuse of a rotated (already-revoked) token revokes every token in the family', async () => {
    const issued = await service.issue(accountId);
    const rotated = await service.rotate(issued.token);

    await expect(service.rotate(issued.token)).rejects.toBeInstanceOf(RefreshTokenReusedError);

    const rows = await prisma.refreshToken.findMany({ where: { familyId: issued.familyId } });
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
    // The token issued by the legitimate rotation is also burned: the family is fully revoked.
    await expect(service.rotate(rotated.token)).rejects.toBeInstanceOf(RefreshTokenReusedError);
  });

  it('distinguishes an expired token from a reused one', async () => {
    const issued = await service.issue(accountId);
    await prisma.refreshToken.updateMany({
      where: { familyId: issued.familyId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(service.rotate(issued.token)).rejects.toBeInstanceOf(RefreshTokenExpiredError);
  });

  it('two concurrent rotate() calls on the same token: exactly one succeeds, the family ends fully revoked', async () => {
    const issued = await service.issue(accountId);

    // A plain shared gate is not enough here: rotate()'s pre-transaction read is a fast, isolated
    // round trip, so two gated calls tend to fully serialize (first commits before the second even
    // reads) and never actually overlap inside Postgres. To force the real race this finding is
    // about, hold both calls right after their (real, unmocked) `existing` read completes, so both
    // enter their transactions with revokedAt: null in hand — exactly the interleaving where the
    // buggy code let both writes through.
    let readsSeen = 0;
    let releaseBothRead!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      releaseBothRead = resolve;
    });
    const originalFindFirst = prisma.refreshToken.findFirst.bind(prisma.refreshToken);
    const findFirstSpy = jest.spyOn(prisma.refreshToken, 'findFirst');
    // The real client method returns a chainable Prisma__RefreshTokenClient, not a plain promise;
    // this test only ever awaits it, so the cast below is safe and avoids reproducing that shape.
    findFirstSpy.mockImplementation(((...args: Parameters<typeof originalFindFirst>) => {
      return (async () => {
        const result = await originalFindFirst(...args);
        readsSeen += 1;
        if (readsSeen >= 2) releaseBothRead();
        await bothRead;
        return result;
      })();
    }) as typeof prisma.refreshToken.findFirst);

    let results: PromiseSettledResult<Awaited<ReturnType<typeof service.rotate>>>[];
    try {
      results = await Promise.allSettled([
        service.rotate(issued.token),
        service.rotate(issued.token),
      ]);
    } finally {
      findFirstSpy.mockRestore();
    }

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(RefreshTokenReusedError);
    }

    // No forked family: every row descended from the presented token ends up revoked, including
    // the successor the winning call minted (reuse detection burns the whole family, R25).
    const rows = await prisma.refreshToken.findMany({ where: { familyId: issued.familyId } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('revoke() revokes only the presented token (logout, not family-wide)', async () => {
    const issued = await service.issue(accountId);

    await service.revoke(issued.token);

    const row = await prisma.refreshToken.findFirstOrThrow({
      where: { familyId: issued.familyId },
    });
    expect(row.revokedAt).not.toBeNull();
  });
});

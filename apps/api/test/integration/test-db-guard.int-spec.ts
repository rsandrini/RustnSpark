import { afterEach, describe, expect, it } from '@jest/globals';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

// Targets the compose `test` profile's tmpfs Postgres (D9): run
// `docker compose --profile test up -d --wait postgres-test` before `pnpm --filter api test:int`.
// Proves the two safety guards in test-db.ts that stop this harness from truncating a database
// that doesn't look like a test database (Important finding from S1.7 review round 1).
describe('test-db.ts safety guards', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    await closeTestPrismaClient();
    process.env = { ...originalEnv };
  });

  it('refuses to build a client whose TEST_DATABASE_URL does not name a test database', () => {
    process.env.TEST_DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/rustandspark_prod';

    expect(() => getTestPrismaClient()).toThrow(/must name a database containing 'test'/);
  });

  it('refuses to reset the connected database when NODE_ENV is not test', async () => {
    delete process.env.TEST_DATABASE_URL; // falls back to the real postgres-test default
    const prisma = getTestPrismaClient();
    process.env.NODE_ENV = 'development';

    await expect(resetDatabase(prisma)).rejects.toThrow(/NODE_ENV/);
  });
});

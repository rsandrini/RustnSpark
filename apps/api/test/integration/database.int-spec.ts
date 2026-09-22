import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

// Targets the compose `test` profile's tmpfs Postgres (D9): run
// `docker compose --profile test up -d --wait postgres-test` before `pnpm --filter api test:int`.
// v0.1 has no domain tables yet (Step 1 ships only the btree_gist extension migration), so this
// probe table stands in for a real one to prove the connection, the raw round trip and the
// deterministic reset all work end to end against a real Postgres instance.
describe('database round-trip against postgres-test', () => {
  const prisma = getTestPrismaClient();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    // resetDatabase refuses to truncate unless NODE_ENV is 'test' (test-db.ts); set it here so
    // this suite is self-contained instead of relying on an ambient CI-only env var.
    process.env.NODE_ENV = 'test';
    await prisma.$executeRawUnsafe(
      'CREATE TABLE IF NOT EXISTS ci_roundtrip_probe (id SERIAL PRIMARY KEY, value TEXT NOT NULL)',
    );
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS ci_roundtrip_probe');
    await closeTestPrismaClient();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('persists a row through a real connection and reads it back', async () => {
    await prisma.$executeRaw`INSERT INTO ci_roundtrip_probe (value) VALUES ('round-trip')`;

    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM ci_roundtrip_probe
    `;

    expect(rows).toEqual([{ value: 'round-trip' }]);
  });

  it('resets state deterministically: the previous test row is gone', async () => {
    const rows = await prisma.$queryRaw<Array<{ value: string }>>`
      SELECT value FROM ci_roundtrip_probe
    `;

    expect(rows).toEqual([]);
  });
});

import { PrismaClient } from '@prisma/client';

// Points integration/e2e tests at the compose `test` profile's tmpfs Postgres (S1.4): run
// `docker compose --profile test up -d --wait postgres-test` before using this helper.
// Override with TEST_DATABASE_URL (documented in .env.example) to target a different instance.
const DEFAULT_TEST_DATABASE_URL =
  'postgresql://rustandspark:rustandspark@127.0.0.1:5433/rustandspark_test';

let sharedClient: PrismaClient | undefined;

// Lazily creates one PrismaClient per test process and reuses it: Postgres connection setup is
// not free, and every caller in a given file wants the same connection anyway.
export function getTestPrismaClient(): PrismaClient {
  sharedClient ??= new PrismaClient({
    datasourceUrl: process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL,
  });
  return sharedClient;
}

// Call from an `afterAll` once a suite is done with the shared client.
export async function closeTestPrismaClient(): Promise<void> {
  if (!sharedClient) return;
  await sharedClient.$disconnect();
  sharedClient = undefined;
}

// TRUNCATE over schema-per-worker: v0.1 has no domain tables yet (Step 1 ships only the
// btree_gist extension migration) and CI runs integration tests as a single worker, so there is
// no parallelism to isolate. TRUNCATE ... RESTART IDENTITY CASCADE resets every table (and its
// identity sequences) in one statement, which is simpler and cheaper than dropping/recreating a
// schema per test file, and it works unchanged once real domain tables land in Step 2.
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')
  `;
  if (tables.length === 0) return;
  const qualifiedNames = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${qualifiedNames} RESTART IDENTITY CASCADE`);
}

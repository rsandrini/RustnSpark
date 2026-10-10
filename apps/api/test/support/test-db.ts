import { PrismaClient } from '@prisma/client';

// Points integration/e2e tests at the compose `test` profile's tmpfs Postgres (S1.4): run
// `docker compose --profile test up -d --wait postgres-test` before using this helper.
// Override with TEST_DATABASE_URL (documented in .env.example) to target a different instance.
const DEFAULT_TEST_DATABASE_URL =
  'postgresql://rustandspark:rustandspark@127.0.0.1:5433/rustandspark_test';

let sharedClient: PrismaClient | undefined;

// TEST_DATABASE_URL has no other validation, so this is what stops a typo'd override from
// pointing this truncating client at a real database. Cheap and synchronous: fails before ever
// opening a connection. The authoritative guard, checked against what is actually connected
// (not just this string), lives in resetDatabase below.
function resolveTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (!/test/i.test(url)) {
    throw new Error(
      "TEST_DATABASE_URL must name a database containing 'test'; refusing to build a client " +
        'that truncates tables against it.',
    );
  }
  return url;
}

// Lazily creates one PrismaClient per test process and reuses it: Postgres connection setup is
// not free, and every caller in a given file wants the same connection anyway.
export function getTestPrismaClient(): PrismaClient {
  sharedClient ??= new PrismaClient({ datasourceUrl: resolveTestDatabaseUrl() });
  return sharedClient;
}

// Call from an `afterAll` once a suite is done with the shared client.
export async function closeTestPrismaClient(): Promise<void> {
  if (!sharedClient) return;
  await sharedClient.$disconnect();
  sharedClient = undefined;
}

// TRUNCATE over schema-per-worker: v0.1 has no domain tables yet (Step 1 ships only the
// btree_gist extension migration) and `test:int` runs with --runInBand (jest.config.ts), so
// there is no parallelism to isolate. TRUNCATE ... RESTART IDENTITY CASCADE resets every table
// (and its identity sequences) in one statement, which is simpler and cheaper than dropping/
// recreating a schema per test file, and it works unchanged once real domain tables land in
// Step 2.
//
// Guarded because this is genuinely destructive and irreversible: refuses to run unless
// NODE_ENV is 'test' AND the *actually connected* database's own name (via current_database(),
// not just the configured URL string, in case a client reached here some other way) contains
// 'test'. Both must hold, so neither a stray NODE_ENV nor a misnamed database alone is enough
// to trigger a truncate.
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const [row] = await prisma.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const databaseName = row?.current_database ?? '';

  if (process.env.NODE_ENV !== 'test' || !/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to reset database "${databaseName}": this only runs when NODE_ENV is 'test' ` +
        `and the connected database's name contains 'test' (NODE_ENV was ` +
        `${JSON.stringify(process.env.NODE_ENV)}).`,
    );
  }

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations')
  `;
  if (tables.length === 0) return;
  const qualifiedNames = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${qualifiedNames} RESTART IDENTITY CASCADE`);
  // Reference data that ships (and their layout validation) depend on must survive resets: the test
  // world has one yard, the roomy 20×20 square, so layouts in any spec fit. (The shipped formats the
  // Admin designed are seeded by the product seed and checked by the seed spec.)
  const cells: [number, number][] = [];
  for (let y = -10; y < 10; y += 1) {
    for (let x = -10; x < 10; x += 1) cells.push([x, y]);
  }
  await prisma.shipFormat.create({
    data: {
      id: 'classic_square',
      displayName: { en: 'Classic Square', 'pt-BR': 'Quadrado Clássico' },
      description: { en: 'Test yard', 'pt-BR': 'Pátio de teste' },
      cells,
      minRarity: 'COMMON',
      active: true,
    },
  });
}

import type { Config } from 'jest';

const base = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
  testEnvironment: 'node',
} satisfies Config;

const config: Config = {
  coverageDirectory: './coverage',
  // Jest treats `collectCoverageFrom` and `coverageThreshold` as global-only options: setting
  // them inside a `projects[]` entry is silently ignored (jest-config normalizes only a fixed
  // list of fields per project, and these two are excluded from it on purpose, precisely because
  // "global" plus glob keys can't be resolved per project). So both live here once, and are only
  // evaluated when a run passes `--coverage`; CI does that for the `unit` project only (see
  // .github/workflows/ci.yml), since that is the one project whose tests exercise this whole
  // source tree today. `main.ts` is excluded: its only uncovered lines are the process-entrypoint
  // guard and bootstrap(), which run for real every time the app boots (proven by the Docker
  // healthcheck and the e2e/validation suites exercising the `configureApp` it wraps), not by
  // tests importing this module. `worker.ts` is excluded for the same reason: its bootstrap() and
  // entrypoint guard run for real every time the worker container boots, proven by the Docker-gated
  // lifecycle test (test/integration/docker-worker-lifecycle.int-spec.ts, DOCKER_TESTS=1) that
  // spawns dist/worker.js as a real process and sends it a real SIGTERM, not by unit tests.
  // `jobs/jobs.module.ts` is excluded too: BullMQ's Queue/Worker connect as soon as the module is
  // compiled (no lazy-connect like RedisClient/PrismaService), so exercising it without a live
  // Redis would mean faking bullmq instead of testing it; it's covered for real by
  // test/integration/jobs.int-spec.ts. queues.ts and processors/ping.processor.ts hold this
  // module's actual logic and are unit-tested directly.
  // `auth/refresh-token.service.ts` is excluded for the same reason: every branch (not-found,
  // expired, reused, rotated) is a real Postgres round trip and the global constraint forbids
  // mocking Prisma to fake them in a unit test; it's covered for real by
  // test/integration/refresh-token.service.int-spec.ts.
  // S2.3's request-path files (auth.controller/auth.service/auth.module, players/*) are excluded
  // for that same reason: their behavior is DB round trips and cookie/HTTP wiring, covered for
  // real by test/integration/auth-*.int-spec.ts and players.int-spec.ts against the real test
  // Postgres booted through createTestApp. Their pure pieces (DTOs, locale resolution, the
  // throttle policy) stay in the unit tree and are unit-tested directly.
  // S2.5's wallet.service.ts and player-event.service.ts are excluded for that same reason: the
  // conditional-UPDATE race semantics only exist on a real Postgres with row locking, proven by
  // test/integration/wallet.int-spec.ts (incl. the 20-parallel-debit test); their pure
  // validators stay unit-tested directly. common/idempotency/idempotency.interceptor.ts
  // likewise: its replay/409/422 paths are IdempotencyKey row round trips, proven by
  // test/integration/idempotency.int-spec.ts; its pure helpers (key extraction, body hashing,
  // passthrough) are unit-tested directly.
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/main.ts',
    '!<rootDir>/src/worker.ts',
    '!<rootDir>/src/jobs/jobs.module.ts',
    '!<rootDir>/src/auth/refresh-token.service.ts',
    '!<rootDir>/src/auth/auth.module.ts',
    '!<rootDir>/src/auth/auth.controller.ts',
    '!<rootDir>/src/auth/auth.service.ts',
    '!<rootDir>/src/players/players.module.ts',
    '!<rootDir>/src/players/players.controller.ts',
    '!<rootDir>/src/players/players.service.ts',
    '!<rootDir>/src/players/wallet.service.ts',
    '!<rootDir>/src/players/player-event.service.ts',
    '!<rootDir>/src/common/idempotency/idempotency.interceptor.ts',
  ],
  coverageThreshold: {
    // Real numbers as of S1.7 (unit project, main.ts excluded): 98.02/84.94/100/98.87
    // (stmts/branches/funcs/lines). Thresholds sit a little below that so incidental variance
    // doesn't flake CI, while still catching an actual coverage regression.
    global: { statements: 95, branches: 80, functions: 95, lines: 95 },
    // Deterministic RNG is a hard game-design constraint (D: rules never call Math.random()):
    // held to the highest bar of any module here.
    './src/common/rng/**/*.ts': { statements: 95, branches: 90, functions: 100, lines: 95 },
    // The boot gate: an untested branch here means an invalid environment could slip through.
    './src/common/env/**/*.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/common/filters/**/*.ts': { statements: 85, branches: 80, functions: 100, lines: 90 },
    './src/common/guards/**/*.ts': { statements: 100, branches: 80, functions: 100, lines: 100 },
    // Below three: line/statement coverage is complete; the remaining branches are defensive
    // fallbacks (e.g. an undefined client IP, a non-Error rejection) that are legitimate but
    // awkward to trigger without contorting the test into mocking away the real dependency.
    './src/common/redis/**/*.ts': { statements: 100, branches: 70, functions: 100, lines: 100 },
    './src/health/**/*.ts': { statements: 100, branches: 70, functions: 100, lines: 100 },
    './src/prisma/**/*.ts': { statements: 100, branches: 70, functions: 100, lines: 100 },
    './src/jobs/queues.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
    './src/jobs/processors/**/*.ts': { statements: 100, branches: 90, functions: 100, lines: 100 },
  },
  projects: [
    {
      ...base,
      displayName: 'unit',
      rootDir: '.',
      testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/unit/**/*.spec.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      rootDir: '.',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
      // Integration specs share one real Postgres and reset it with a TRUNCATE (test-db.ts);
      // running two spec files concurrently would race one file's afterEach truncate against
      // another's in-flight assertions. `maxWorkers` is global-only (same as coverageThreshold
      // above: jest-config ignores it inside a project block), so serialization is done via
      // `--runInBand` on the `test:int` script instead, not here.
    },
    {
      ...base,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
    },
    {
      ...base,
      displayName: 'validation',
      rootDir: '.',
      testMatch: ['<rootDir>/test/validation/**/*.spec.ts'],
    },
  ],
};

export default config;

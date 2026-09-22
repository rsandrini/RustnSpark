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
  // tests importing this module.
  collectCoverageFrom: ['<rootDir>/src/**/*.ts', '!<rootDir>/src/main.ts'],
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
  },
  projects: [
    { ...base, displayName: 'unit', rootDir: '.', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'integration',
      rootDir: '.',
      testMatch: ['<rootDir>/test/integration/**/*.int-spec.ts'],
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

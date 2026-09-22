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

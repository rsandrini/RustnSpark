import { defineConfig } from '@playwright/test';

/**
 * Browser smoke against the REAL stack (`docker compose --profile dev up`): real API, real
 * worker, real Postgres/Redis, the built SPA behind nginx. Nothing is mocked, so it catches what
 * the MSW-backed unit tests cannot (a wrong route, a missing Idempotency-Key, a shape the server
 * never sends). It runs non-blocking in CI at first (owner decision), then becomes required.
 *
 * Env: E2E_BASE_URL (default http://127.0.0.1:8080), E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (an
 * admin created with the CLI; used only to make missions finish in seconds).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    {
      name: 'phone',
      use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
});

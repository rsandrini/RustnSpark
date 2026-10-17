import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: /shots\.mjs/,
  snapshotPathTemplate: '{testDir}/__shots__/{arg}{ext}',
  workers: 1,
  timeout: 300000,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.0005, animations: 'disabled', caret: 'hide' },
  },
  use: { baseURL: 'http://localhost:8080', trace: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});

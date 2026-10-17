// One-time: a stable account with an assembled ship and one finished mission, so every screen has fixed data.
import { chromium } from '@playwright/test';
const base = 'http://localhost:8080';
const admin = { email: 'admin@e2e.test', password: 'e2e-admin-password-1' };
const email = 'visual@e2e.test',
  password = 'visual-player-password-1';

async function api(path, method = 'GET', body, token) {
  const r = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.ok
    ? r.status === 204
      ? null
      : r.json()
    : Promise.reject(new Error(`${method} ${path} ${r.status}`));
}
async function setTimeScale(value) {
  const { accessToken } = await api('/v1/auth/login', 'POST', admin);
  const rev = await api('/v1/admin/tuning/revisions?limit=1', 'GET', undefined, accessToken);
  await api(
    '/v1/admin/tuning/config/missions.time_scale',
    'PATCH',
    { value, expectedRevision: Number(rev[0]?.id ?? 0), reason: 'visual setup' },
    accessToken,
  );
  await new Promise((r) => setTimeout(r, 3500));
}
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await setTimeScale(0.001);
try {
  await page.goto(base + '/register');
  await page.getByLabel('Name').fill('visualpilot');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: /Choose your faction/i }).waitFor({ timeout: 15000 });
  await page.locator('label.faction-card', { hasText: /luna/i }).click();
  await page.getByRole('button', { name: 'Launch' }).click();
  await page.waitForURL(/ship/);
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await page.waitForTimeout(2000);
  await page.goto(base + '/missions');
  await page.locator('button:has-text("Accept"):not([disabled])').first().click();
  await page.waitForURL(/ship/);
  await page.getByRole('button', { name: 'Dispatch' }).click();
  await page.waitForURL(/report/, { timeout: 90000 });
  console.log('visual account ready');
} finally {
  await setTimeScale(1);
  await browser.close();
}

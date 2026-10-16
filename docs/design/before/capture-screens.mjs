import { chromium } from '/home/rsandrini/Projects/RustnSpark/apps/web/node_modules/@playwright/test/index.mjs';
const out = process.env.CLAUDE_JOB_DIR + '/tmp/shots';
const base = 'http://localhost:8080';
const id = 'ux' + Date.now().toString(36);
const browser = await chromium.launch();
async function shot(page, name) { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); console.log('shot', name); }
for (const [label, viewport] of [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  if (label === 'd') { await page.goto(base + '/login'); await shot(page, 'd-login'); }
  const uid = id + label;
  await page.goto(base + '/register');
  await page.getByLabel('Name').fill(uid.slice(0, 20));
  await page.getByLabel('Email').fill(`${uid}@e2e.test`);
  await page.getByLabel('Password').fill('e2e-player-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Choose your faction' }).waitFor({ timeout: 15000 });
  await shot(page, `${label}-onboarding`);
  await page.locator('label.faction-card', { hasText: /luna/i }).click();
  await page.getByRole('button', { name: 'Launch' }).click();
  await page.getByRole('navigation').first().waitFor();
  await page.waitForURL(/hangar/);
  await page.getByRole('button', { name: 'Auto layout' }).click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, `${label}-hangar-ship`);
  for (const [name, path] of [['port', '/hangar/port'], ['board', '/hangar/board'], ['map', '/map'], ['profile', '/profile']]) {
    await page.goto(base + path);
    await shot(page, `${label}-${name}`);
  }
  // port sub tabs
  await page.goto(base + '/hangar/port');
  const tabs = await page.getByRole('tab').allInnerTexts();
  console.log(label, 'port tabs:', tabs.join(' | '));
  for (const t of tabs.slice(0, 8)) {
    await page.getByRole('tab', { name: t, exact: true }).first().click().catch(() => {});
    await shot(page, `${label}-port-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`);
  }
  await ctx.close();
}
await browser.close();

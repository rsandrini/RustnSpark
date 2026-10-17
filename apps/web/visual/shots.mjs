import { test, expect } from '@playwright/test';
const player = { email: 'visual@e2e.test', password: 'visual-player-password-1' };
const admin = { email: 'admin@e2e.test', password: 'e2e-admin-password-1' };
const HIDE = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  .tutorial-card, .tutorial-pill { display: none !important; }
  [data-testid="countdown"], time { visibility: hidden !important; }
  .place-missions, .mrow-list { height: 160px !important; overflow: hidden !important; }
`;
async function login(page, who) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page
    .getByRole('button', { name: /Sign in/i })
    .last()
    .click();
  await page.waitForTimeout(2500); // the landing differs by account (an admin has no faction)
}
async function shot(page, name, opts = {}) {
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(700);
  const check = opts.soft ? expect.soft : expect;
  delete opts.soft;
  await check(page).toHaveScreenshot(`${name}.png`, { fullPage: true, ...opts });
}
const dynamic = (page) => [
  page.locator('.mrow-list'),
  page.locator('.place-missions'),
  page.locator('.countdown'),
  page.locator('.stage-caption'),
];

test('logged-out screens', async ({ page }) => {
  await page.goto('/login');
  await shot(page, `${test.info().project.name}-login`);
  await page.goto('/register');
  await shot(page, `${test.info().project.name}-register`);
  await page.goto('/forgot-password');
  await shot(page, `${test.info().project.name}-forgot`);
});

test('player screens', async ({ page }) => {
  const p = test.info().project.name;
  await login(page, player);
  await page.goto('/ship');
  await page.waitForTimeout(1500);
  await shot(page, `${p}-ship`, { mask: [page.locator('.ship-stage-wrap')] });
  await page.getByRole('tab', { name: 'Store' }).click();
  await shot(page, `${p}-ship-store`, { mask: [page.locator('.ship-stage-wrap')] });
  const GROUP = {
    Market: 'Buy',
    'Your goods': 'Buy',
    Repair: 'Service',
    Refuel: 'Service',
    Upgrade: 'Service',
    Scavenging: 'Work',
  };
  await page.goto('/port');
  await page.waitForTimeout(800);
  for (const tab of ['Market', 'Your goods', 'Repair', 'Refuel', 'Upgrade', 'Scavenging']) {
    const groupTab = page.getByRole('tab', { name: new RegExp(`^${GROUP[tab]}`) });
    if ((await groupTab.getAttribute('aria-selected')) !== 'true') await groupTab.click();
    await page.getByRole('tab', { name: tab === 'Repair' ? /^Repair/ : tab }).click();
    await shot(page, `${p}-port-${tab.replace(/\W+/g, '-').toLowerCase()}`, {
      mask: [page.locator('.ship-stage-wrap')],
    });
  }
  await page.goto('/missions');
  await page.waitForTimeout(800);
  await shot(page, `${p}-missions`, { mask: [...dynamic(page), page.locator('.ship-stage-wrap')] });
  const summary = page.locator('.mrow-details summary').first();
  if (await summary.count()) {
    await summary.click();
    await shot(page, `${p}-missions-details`, {
      mask: [...dynamic(page), page.locator('.ship-stage-wrap'), page.locator('.mrow-details')],
    });
  }
  await page.goto('/map');
  await page.waitForTimeout(800);
  await shot(page, `${p}-map`, { mask: dynamic(page) });
  await page.goto('/map?place=ceres');
  await page.waitForTimeout(800);
  await shot(page, `${p}-map-place`, { mask: dynamic(page) });
  await page.goto('/profile');
  await page.waitForTimeout(800);
  await shot(page, `${p}-profile`);
  await page.getByRole('link', { name: 'View report' }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, `${p}-report-overview`);
  await page.getByRole('tab', { name: 'The story' }).click();
  await shot(page, `${p}-report-story`);
  await page.getByRole('tab', { name: 'Log' }).click();
  await shot(page, `${p}-report-log`);
  await page.goto('/guide/fuel');
  await page.waitForTimeout(800);
  await shot(page, `${p}-guide`);
  await page.goto('/guide');
  await page.getByRole('searchbox').fill('shield');
  await shot(page, `${p}-guide-search`);
});

test('admin screens', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'the admin is a desktop tool');
  await login(page, admin);
  for (const [name, path] of [
    ['dash', '/admin'],
    ['config', '/admin/tuning/config'],
    ['parts', '/admin/tuning/entities/parts'],
    ['locations', '/admin/tuning/entities/locations'],
    ['players', '/admin/players'],
    ['system', '/admin/system'],
    ['revisions', '/admin/tuning/revisions'],
    ['economy', '/admin/analytics/economy'],
  ]) {
    await page.goto(path);
    await page.waitForTimeout(1200);
    await shot(page, `desktop-admin-${name}`, {
      mask: [page.locator('canvas'), page.locator('svg.chart')],
      maxDiffPixelRatio: 0.02,
    });
  }
});

test('mission card states', async ({ page }) => {
  const p = test.info().project.name;
  await login(page, player);
  // text of the offer is random: hide the glyphs (not the boxes) so the card's own styling is what is compared
  const quiet =
    '.mrow-details *, .transit-card *, .mcard * { color: transparent !important; text-shadow: none !important; }';
  await page.goto('/missions');
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: quiet });
  const open = page.locator('.mrow-details summary').first();
  if (await open.count()) {
    await open.click();
  }
  await page.addStyleTag({
    content: '.mrow-list > li:not(:first-child) { display: none !important; }',
  });
  await shot(page, `${p}-card-details`, { maxDiffPixelRatio: 0.03, soft: true });
  const accept = page.locator('button:has-text("Accept"):not([disabled])').first();
  if (await accept.count()) {
    try {
      await accept.click();
      await page.waitForURL(/ship/);
      await page.waitForTimeout(1500);
      await page.addStyleTag({ content: quiet });
      await shot(page, `${p}-card-accepted`, {
        maxDiffPixelRatio: 0.03,
        soft: true,
        mask: [page.locator('.ship-stage-wrap'), page.locator('.transit-scene')],
      });
    } finally {
      const cancel = page.getByRole('button', { name: 'Cancel mission' });
      while (await cancel.count()) {
        await cancel.first().click();
        await page.waitForTimeout(1500);
      }
    }
  }
});

test('popups and hover cards', async ({ page }) => {
  const p = test.info().project.name;
  await login(page, player);
  await page.goto('/port');
  await page.waitForTimeout(1200);
  // the part (i) popup
  const info = page.locator('.pcard .info-btn').first();
  await info.click();
  await page.waitForTimeout(600);
  await shot(page, `${p}-popup-part-info`, { mask: [page.locator('.ship-stage-wrap')] });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // the buy confirmation
  const buy = page.getByRole('button', { name: /^Buy\b/ }).first();
  if ((await buy.count()) && (await buy.isEnabled())) {
    await buy.click();
    await page.waitForTimeout(600);
    await shot(page, `${p}-popup-buy`, { mask: [page.locator('.ship-stage-wrap')] });
    await page.keyboard.press('Escape');
  }
  // the ship tray with a hover compare card (desktop only: there is no hover on a phone)
  if (p === 'desktop') {
    await page.goto('/ship');
    await page.waitForTimeout(1200);
    await page.getByRole('tab', { name: 'Store' }).click();
    await page.waitForTimeout(800);
    await page.locator('.pcard').first().hover();
    await page.waitForTimeout(500);
    await shot(page, `${p}-hover-store-card`, { mask: [page.locator('.ship-stage-wrap')] });
  }
});

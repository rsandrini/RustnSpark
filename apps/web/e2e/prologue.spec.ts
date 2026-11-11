import { expect, test, type Locator, type Page } from '@playwright/test';
import { walletOf } from './support';

/**
 * The new-pilot opening against the real stack: a fresh account meets the story on the game's own screens before the
 * faction picker, skipping asks twice, a played opening and a skipped one end with the same credits, and once it is over
 * (or skipped) it never shows again.
 */

async function register(page: Page): Promise<void> {
  const id = `open${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto('/register');
    await page.getByLabel('Name').fill(id.slice(0, 20));
    await page.getByLabel('Email').fill(`${id}@e2e.test`);
    await page.getByLabel('Password').fill('e2e-player-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    const ok = await page
      .getByTestId('opening-bar')
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    await page.waitForTimeout(22_000); // registration is throttled per IP
  }
  throw new Error('could not register');
}

const bar = (page: Page) => page.getByTestId('opening-bar');
const onStep = (page: Page, id: string, timeout = 15_000) =>
  expect(bar(page)).toHaveAttribute('data-step', id, { timeout });

/** Reads a guide's lines to the end: the first press finishes the typing, the next goes on. */
async function read(page: Page): Promise<void> {
  const box = page.getByTestId('dialogue');
  // the lines of a step open a moment after the step starts
  await box.waitFor({ timeout: 3000 }).catch(() => undefined);
  for (let guard = 0; guard < 40 && (await box.isVisible().catch(() => false)); guard += 1) {
    await box
      .locator('.dialogue-actions .btn.primary')
      .first()
      .click({ timeout: 2000 })
      .catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

/** The step's button that moves the story on (a report to read, the gift, the choice of job). */
async function next(page: Page): Promise<void> {
  await page.getByTestId('opening-continue').click();
  // the lines said when a step ends
  await read(page);
}

/** Puts a loose part on the yard (tap the part, then tap the cell) and saves the layout. */
async function dragPart(page: Page, name: RegExp, gx: number, gy: number): Promise<void> {
  const row: Locator = page.locator('.hangar-side .part-btn', { hasText: name }).first();
  // on a phone the loose parts are in a sheet behind the Parts button
  const sheet = page.getByRole('button', { name: /^Parts \(/ });
  if (await sheet.isVisible().catch(() => false)) await sheet.click();
  await expect(row).toBeVisible();
  await row.click();
  const cell = page
    .locator(`.hangar-scene svg rect.yard-cell[data-gx="${gx}"][data-gy="${gy}"]`)
    .first();
  const box = await cell.boundingBox();
  if (box === null) throw new Error('no such cell');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // there is no Save button in the opening: the layout saves itself a moment after the drop
  await expect(page.getByRole('button', { name: 'Save layout' })).toHaveCount(0);
  // the lines said when the step ends
  await read(page);
}

async function dispatch(page: Page): Promise<void> {
  await page.locator('[data-tour="dispatch_button"]').click();
}

async function accept(page: Page, index = 0): Promise<void> {
  await page.locator('[data-tour="accept_button"]:not([disabled])').nth(index).click();
}

/** Plays the whole opening up to the faction picker. */
async function playOpening(page: Page): Promise<void> {
  await onStep(page, 'gift');
  await read(page);
  await next(page);

  await onStep(page, 'fit-engine');
  await read(page);
  await dragPart(page, /engine/i, -4, 0);

  await onStep(page, 'race-board');
  await read(page);
  await accept(page);
  await read(page);
  await onStep(page, 'race');
  await read(page);
  await dispatch(page);
  // the three legs take about a minute; the friend's radio lines come on the way
  for (let guard = 0; guard < 60; guard += 1) {
    await read(page);
    if ((await bar(page).getAttribute('data-step')) !== 'race') break;
    await page.waitForTimeout(2000);
  }

  await onStep(page, 'race-report');
  await read(page);
  await next(page);

  await onStep(page, 'stop-port');
  await read(page);
  await expect(page).toHaveURL(/\/port/, { timeout: 10_000 });
  const refuelTab = page.getByRole('tab', { name: /^Refuel/ });
  if ((await refuelTab.getAttribute('aria-selected')) !== 'true') await refuelTab.click();
  await page.getByRole('button', { name: /^Buy \d+/ }).click({ timeout: 15_000 });
  await read(page);

  await onStep(page, 'choose-job');
  await read(page);
  await page.locator('[data-opening="choose"]').first().click();
  await read(page);

  await onStep(page, 'buy-module');
  await read(page);
  await page.getByRole('button', { name: /^Buy/ }).first().click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /^Buy/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await read(page);

  await onStep(page, 'fit-module');
  await read(page);
  await dragPart(page, /module|cargo/i, 1, 0);

  await onStep(page, 'dispatch-job');
  await read(page);
  await accept(page);
  await dispatch(page);
  for (let guard = 0; guard < 60; guard += 1) {
    if ((await bar(page).getAttribute('data-step')) !== 'dispatch-job') break;
    await read(page);
    await page.waitForTimeout(2000);
  }

  await onStep(page, 'job-report');
  await read(page);
  await next(page);

  // the friend warns about the pirates, hands over scrap, and the pilot makes the hull stronger
  await onStep(page, 'upgrade');
  await read(page);
  await expect(page.getByTestId('upgrade-needs')).toBeVisible();
  await page
    .getByRole('button', { name: /^Upgrade$/ })
    .first()
    .click();
  const sure = page.getByRole('dialog').getByRole('button', { name: /Upgrade/ });
  if (await sure.isVisible().catch(() => false)) await sure.click();
  await read(page);

  await onStep(page, 'stop-two');
  await read(page);
  await accept(page);
  await dispatch(page);
  await expect(page.getByTestId('opening-continue')).toBeVisible({ timeout: 120_000 });
  await read(page);
  await next(page);

  await onStep(page, 'final-board');
  await read(page);
  await accept(page);
  await read(page);
  await onStep(page, 'final-run');
  await read(page);
  await dispatch(page);
  for (let guard = 0; guard < 90; guard += 1) {
    await read(page);
    if ((await bar(page).getAttribute('data-step')) !== 'final-run') break;
    await page.waitForTimeout(2000);
  }

  await onStep(page, 'loss');
  await expect(page.getByTestId('loss-moment')).toBeVisible();
  await read(page);
  await page.getByTestId('loss-continue').click();
  await read(page);

  await onStep(page, 'rescue');
  await expect(page.getByTestId('rescue-moment')).toBeVisible();
  await read(page);
  await next(page);
  await read(page);
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible({
    timeout: 20_000,
  });
}

async function launch(page: Page): Promise<void> {
  await page.locator('label.faction-card', { hasText: /luna/i }).click();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

test('a new pilot meets the opening first, and skipping asks twice', async ({ page }) => {
  await register(page);
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Skip the opening' }).click();
  const warning = page.getByRole('dialog', { name: 'Skip the opening?' });
  await expect(warning).toContainText('first time');
  await warning.getByRole('button', { name: 'Play the opening' }).click();
  await expect(warning).toHaveCount(0);
  await expect(bar(page)).toBeVisible();

  await page.getByRole('button', { name: 'Skip the opening' }).click();
  await page.getByRole('button', { name: 'Skip anyway' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible();

  // gone for good, even after a reload
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test('the guide speaks in the middle of the screen, and the screen around it is locked', async ({
  page,
}) => {
  await register(page);
  const box = page.getByTestId('dialogue').locator('.dialogue-box');
  await expect(box).toHaveAttribute('data-position', 'center');
  await read(page);
  await next(page);
  await onStep(page, 'fit-engine');
  // the other tabs are shown, but off
  await expect(page.locator('[aria-disabled="true"].nav-link').first()).toBeVisible();
});

test('the opening resumes where the pilot left it', async ({ page }) => {
  await register(page);
  await read(page);
  await next(page);
  await onStep(page, 'fit-engine');
  await page.reload();
  await onStep(page, 'fit-engine');
});

test('a played opening and a skipped one end with the same credits', async ({ page, browser }) => {
  test.setTimeout(900_000);
  await register(page);
  await playOpening(page);
  await launch(page);
  const played = await walletOf(page);

  const other = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await register(other);
  await other.getByRole('button', { name: 'Skip the opening' }).click();
  await other.getByRole('button', { name: 'Skip anyway' }).click();
  await launch(other);
  expect(await walletOf(other)).toBe(played);
  await other.close();
});

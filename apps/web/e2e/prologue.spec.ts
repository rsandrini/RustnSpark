import { expect, test, type Page } from '@playwright/test';
import { walletOf } from './support';

/**
 * The new-pilot opening against the real stack: a fresh account meets the story before the faction picker,
 * skipping asks twice, a played opening and a skipped one end with the same credits, and once it is over (or
 * skipped) it never shows again.
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
      .getByTestId('prologue')
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    await page.waitForTimeout(22_000); // registration is throttled per IP
  }
  throw new Error('could not register');
}

const stepOf = (page: Page) => page.getByTestId('prologue');

/** Reads a guide's lines to the end: the first press finishes the typing, the next goes on. */
async function dismissGuide(page: Page): Promise<void> {
  const box = page.getByTestId('dialogue');
  for (let guard = 0; guard < 12 && (await box.isVisible().catch(() => false)); guard += 1) {
    await box.getByRole('button').first().click();
    await page.waitForTimeout(150);
  }
}

/** Fits the part the scene offers: pick it from the tray, then click the cell it belongs in. */
async function fitPart(page: Page, gx: number, gy: number): Promise<void> {
  const sheet = page.getByTestId('fit-open-sheet');
  if (await sheet.isVisible().catch(() => false)) await sheet.click();
  await page.getByTestId('fit-part').click();
  await page.locator(`rect[data-gx="${gx}"][data-gy="${gy}"]`).first().click();
  await expect(page.getByTestId('fit-done')).toBeVisible();
}

async function dispatch(page: Page, index = 0): Promise<void> {
  await page
    .getByRole('button', { name: /^Dispatch$/ })
    .nth(index)
    .click();
}

/** Plays the whole opening up to the faction picker. */
async function playOpening(page: Page): Promise<void> {
  await expect(stepOf(page)).toHaveAttribute('data-step', 'gift');
  await dismissGuide(page);

  await expect(stepOf(page)).toHaveAttribute('data-step', 'fit-engine');
  await dismissGuide(page);
  await fitPart(page, -4, 0);
  await dismissGuide(page);

  await expect(stepOf(page)).toHaveAttribute('data-step', 'race-board');
  await dismissGuide(page);
  await dispatch(page);
  await expect(stepOf(page)).toHaveAttribute('data-step', 'race');
  for (let leg = 0; leg < 3; leg += 1) await page.getByTestId('race-skip').click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(stepOf(page)).toHaveAttribute('data-step', 'stop-one');
  await dismissGuide(page);
  await page.getByRole('button', { name: /^Refuel/ }).click();
  await dispatch(page, 1);
  await expect(stepOf(page)).toHaveAttribute('data-step', 'offer-run-1');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(stepOf(page)).toHaveAttribute('data-step', 'fit-cargo');
  await dismissGuide(page);
  await fitPart(page, 1, 0);
  await dismissGuide(page);

  await expect(stepOf(page)).toHaveAttribute('data-step', 'stop-two');
  await dismissGuide(page);
  await dispatch(page, 0);
  await expect(stepOf(page)).toHaveAttribute('data-step', 'offer-run-2');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(stepOf(page)).toHaveAttribute('data-step', 'final-board');
  await dismissGuide(page);
  await dispatch(page);
  await expect(stepOf(page)).toHaveAttribute('data-step', 'final-run');
  await page
    .getByRole('button', { name: /continue|next/i })
    .first()
    .click();
  await expect(stepOf(page)).toHaveAttribute('data-step', 'loss');
  await page.getByRole('alertdialog').getByRole('button').click();

  await expect(stepOf(page)).toHaveAttribute('data-step', 'rescue');
  await dismissGuide(page);
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible();
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
  await expect(stepOf(page)).toBeVisible();

  await page.getByRole('button', { name: 'Skip the opening' }).click();
  await page.getByRole('button', { name: 'Skip anyway' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible();

  // gone for good, even after a reload
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible();
  await expect(stepOf(page)).toHaveCount(0);
});

test('the opening resumes where the pilot left it', async ({ page }) => {
  await register(page);
  await dismissGuide(page);
  await expect(stepOf(page)).toHaveAttribute('data-step', 'fit-engine');
  await page.reload();
  await expect(stepOf(page)).toHaveAttribute('data-step', 'fit-engine');
});

test('a played opening and a skipped one end with the same credits', async ({ page, browser }) => {
  await register(page);
  await playOpening(page);
  await expect(page.getByTestId('prologue-port')).toBeVisible();
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

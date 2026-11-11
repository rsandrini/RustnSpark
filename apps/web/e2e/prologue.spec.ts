import { expect, test, type Page } from '@playwright/test';
import { walletOf } from './support';
import { accept, bar, dispatch, dragPart, next, onStep, read, register } from './opening-support';

/**
 * The new-pilot opening against the real stack: a fresh account meets the story on the game's own screens before the
 * faction picker, skipping asks twice, a played opening and a skipped one end with the same credits, and once it is over
 * (or skipped) it never shows again.
 */

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
  // the second job needs no report to read: the story goes on by itself
  for (let guard = 0; guard < 90; guard += 1) {
    await read(page);
    if ((await bar(page).getAttribute('data-step')) !== 'stop-two') break;
    await page.waitForTimeout(2000);
  }

  await onStep(page, 'final-run');
  await read(page);
  await accept(page);
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

import { expect, test } from '@playwright/test';
import { assertClean, flyOneMission, registerAndLaunch, walletOf } from './support';

/**
 * S12.4: the money flows on the real stack — buy, sell, refuel and repair as a player does them
 * in the port, with the confirmation dialogs, the Idempotency-Keys and the server's own prices.
 * (Rescue needs a stranded ship, which the real engine only produces after a failed run; it is
 * covered by the API integration spec and the MSW-backed screen test instead.)
 */

test('buy a part, see it in your goods, sell it back for less than you paid', async ({ page }) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/port');
  await expect(page.getByRole('heading', { name: 'Port', exact: true })).toBeVisible();
  const before = await walletOf(page);

  // Cheapest thing the player can afford.
  const buy = page.locator('button:has-text("Buy"):not([disabled])').first();
  await expect(buy).toBeVisible();
  await buy.click();
  const buyDialog = page.getByRole('dialog');
  await expect(buyDialog).toContainText('Balance after');
  await buyDialog.getByRole('button', { name: 'Buy' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/^Bought /)).toBeVisible();

  const afterBuy = await walletOf(page);
  expect(afterBuy).toBeLessThan(before);
  await assertClean(page, 'port after buy');

  // The purchase is now in "Your goods" and can be sold (used parts sell for less than new).
  await page.getByRole('tab', { name: 'Your goods' }).click();
  const sell = page.locator('button:has-text("Sell"):not(:has-text("Sell all"))').first();
  await expect(sell).toBeVisible();
  await sell.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sell' }).click();
  await expect(page.getByText(/^Sold /)).toBeVisible();
  const afterSell = await walletOf(page);
  expect(afterSell).toBeGreaterThan(afterBuy);
  expect(afterSell).toBeLessThan(before + 1);
});

test('after a flight: fill the tank for credits, then the tank is full', async ({ page }) => {
  await registerAndLaunch(page, 'sun');
  await flyOneMission(page);
  await page.goto('/port');
  await page.getByRole('tab', { name: 'Refuel' }).click();

  // The slider opens on "fill the tank"; buying that amount empties the panel.
  const buy = page.getByRole('button', { name: /^Buy \d+$/ });
  if (await buy.isVisible()) {
    const before = await walletOf(page);
    await buy.click();
    await expect(page.getByText(/^Filled \d+ units/)).toBeVisible();
    expect(await walletOf(page)).toBeLessThanOrEqual(before);
  }
  await expect(page.getByText('The tank is already full.')).toBeVisible();
  await assertClean(page, 'port refuel after fill');
});

test('repair: worn parts are quoted, confirmed and charged; a clean ship says so', async ({
  page,
}) => {
  await registerAndLaunch(page, 'explorers');
  await flyOneMission(page);
  await page.goto('/port');
  await page.getByRole('tab', { name: /^Repair/ }).click();

  const clean = page.getByText('Every installed part is at full condition.');
  if (await clean.isVisible()) {
    await assertClean(page, 'port repair (nothing to repair)');
    return;
  }
  const before = await walletOf(page);
  // Nothing is selected until the pilot moves a slider; "Set all to 100%" selects the whole ship,
  // the screen shows the server's price and time per part and in total, and "Start repair"
  // opens the confirmation dialog.
  await expect(page.getByTestId('repair-summary')).toContainText('Nothing selected yet');
  await page.getByRole('button', { name: 'Set all to 100%' }).click();
  await expect(page.getByTestId('repair-total')).toContainText('¢');
  await page.getByTestId('repair-summary').getByRole('button', { name: 'Start repair' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Repair cost');
  await dialog.getByRole('button', { name: 'Start repair' }).click();
  await expect(page.getByText(/^Repair started for \d+ ¢/)).toBeVisible();
  expect(await walletOf(page)).toBeLessThan(before);
  await assertClean(page, 'port repair started');
});

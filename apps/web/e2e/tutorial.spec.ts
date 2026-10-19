import { expect, test } from '@playwright/test';
import { flyOneMission, openPortTab, registerAndLaunch } from './support';

/**
 * The newcomer checklist ticks from what the pilot really does on the real stack: after the first
 * flight the tank is a little short, and paying for fuel ticks "Top up the tank".
 */
test('the checklist ticks "Top up the tank" after a real refuel', async ({ page }) => {
  await registerAndLaunch(page, 'luna');
  await flyOneMission(page);
  await page.goto('/port');
  await openPortTab(page, 'Refuel');

  const buy = page.getByRole('button', { name: /^Buy \d+$/ });
  await expect(buy, 'the first flight must leave the tank a little short').toBeVisible();
  await buy.click();
  await expect(page.getByText(/^Filled \d+ units/)).toBeVisible();

  await page.goto('/ship');
  // on a phone the checklist is a small pill until it is opened
  const step = page.locator('.tutorial-step', { hasText: 'Top up the tank' });
  if ((await step.count()) === 0) {
    await page.getByRole('button', { name: /Getting started/ }).click();
  }
  await expect(step).toHaveClass(/done/);
});

test('a new pilot sees the recommended shield and battery on the Ship screen', async ({ page }) => {
  await registerAndLaunch(page, 'sun');
  await page.goto('/ship');
  const needs = page.getByTestId('ship-needs');
  await expect(needs).toBeVisible();
  await expect(needs).toContainText('Recommended: a shield');
});

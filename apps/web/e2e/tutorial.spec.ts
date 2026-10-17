import { expect, test } from '@playwright/test';
import { registerAndLaunch } from './support';

/**
 * The newcomer tutorial against the real stack: a fresh pilot sees the checklist, building the ship
 * ticks its first step, skipping it is saved on the server (it stays gone after a reload), and the
 * account menu brings it back.
 */
test('the tutorial card ticks, can be skipped for good, and comes back from the account menu', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/ship');

  const card = page.getByTestId('tutorial-card');
  await expect(card).toBeVisible();
  // collapsed on a phone: open it
  if (await card.evaluate((node) => node.tagName === 'BUTTON')) await card.click();
  const open = page.getByTestId('tutorial-card');
  await expect(open.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(open.locator('li', { hasText: 'Build your ship' })).toHaveClass(/done/);

  await open.getByRole('button', { name: 'Skip tutorial' }).click();
  await open.getByRole('button', { name: 'Yes, skip it' }).click();
  await expect(page.getByTestId('tutorial-card')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'My Ship' })).toBeVisible();
  await expect(page.getByTestId('tutorial-card')).toHaveCount(0);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('button', { name: 'Getting started' }).click();
  await expect(page.getByTestId('tutorial-card')).toBeVisible();
});

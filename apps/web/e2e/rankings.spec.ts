import { expect, test } from '@playwright/test';
import { assertClean, flyOneMission, registerAndLaunch } from './support';

// The rankings on the real stack: a pilot who has flown appears on the distance board, this week and all time, and
// every board answers.
test.use({ reducedMotion: 'reduce' });

test('a flown pilot is on the distance board, weekly and all time, and every board opens', async ({
  page,
}) => {
  await registerAndLaunch(page, 'sun');
  await flyOneMission(page);

  await page.goto('/rankings');
  const list = page.getByTestId('ranking-list');
  await expect(list).toBeVisible();
  await expect(list.locator('.rankings-row.me')).toHaveCount(1);
  await assertClean(page, 'rankings (weekly distance)');

  await page.getByRole('button', { name: 'All time' }).click();
  await expect(page.locator('.rankings-row.me')).toHaveCount(1);

  // the others answer, whatever they hold (an empty board says so)
  for (const board of ['Fights won', 'Race wins', 'Fastest race']) {
    await page.getByRole('tab', { name: board }).click();
    await expect(page.getByRole('tab', { name: board })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  await assertClean(page, 'rankings (race board)');

  // the account menu leads here
  await page.goto('/ship');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('link', { name: 'Rankings' }).click();
  await expect(page).toHaveURL(/\/rankings/);
});

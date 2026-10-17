import { expect, test } from '@playwright/test';
import { registerAndLaunch } from './support';

/** The in-game Guide against the real stack: reached from the account menu, searchable by mechanic and by
    part name, and quoting the live numbers from the server's rules. */
test('the guide opens from the account menu, searches parts and mechanics, and quotes live numbers', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Guide' }).click();
  await expect(page).toHaveURL(/\/guide/);

  const box = page.getByRole('searchbox', { name: 'Search the guide' });
  await box.fill('shield');
  await expect(
    page.getByTestId('guide-results').getByRole('link', { name: /Shield and armor/ }),
  ).toBeVisible();

  await box.fill('fuel tank');
  await expect(
    page
      .getByTestId('guide-results')
      .getByText(/Part · Tank/)
      .first(),
  ).toBeVisible();

  await page.goto('/guide/fuel');
  const live = page.getByTestId('guide-live');
  await expect(live.getByText('Fuel price per unit')).toBeVisible();
  await expect(live).toContainText('¢');
  await expect(page.locator('body')).not.toContainText('{{');
});

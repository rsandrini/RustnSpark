import { expect, test } from '@playwright/test';
import { openPortTab, registerAndLaunch } from './support';

/**
 * Keyboard use against the real stack (phase 4, H3): the top bar is reachable in order and every stop shows a
 * focus ring, Escape closes the account menu, tab lists answer the arrow keys, a map place opens with Enter,
 * and the Guide search is operable with Enter and Escape.
 */
const hasRing = async (locator: import('@playwright/test').Locator) =>
  locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    return outline || style.boxShadow !== 'none';
  });

test('the top bar is in the tab order and every stop has a visible focus ring', async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== 'desktop',
    'the top row of links is a desktop layout (phones have the tab bar)',
  );
  await registerAndLaunch(page, 'luna');
  await page.goto('/ship');
  await expect(page.getByRole('heading', { name: 'My Ship' })).toBeVisible();
  const names = ['rustnspark', 'Ship', 'Port', 'Missions', 'Map', 'Account menu'];
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (const name of names) {
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused, `Tab should reach ${name}`).toHaveAccessibleName(name);
    expect(await hasRing(focused), `${name} shows a focus ring`).toBe(true);
  }
});

test('the account menu opens with the keyboard and Escape closes it', async ({ page }) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/ship');
  const avatar = page.getByRole('button', { name: 'Account menu' });
  await avatar.focus();
  await page.keyboard.press('Enter');
  await expect(avatar).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Guide' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(avatar).toHaveAttribute('aria-expanded', 'false');
});

test('tab lists answer the arrow keys, and the list is one stop in the tab order', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/port');
  const buy = page.getByRole('tab', { name: /^Buy/ });
  await buy.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Service/ })).toBeFocused();
  await expect(page.getByRole('tab', { name: /^Service/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /^Work/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: /^Buy/ })).toHaveAttribute('aria-selected', 'true');
  // only the selected tab of a list is a tab stop
  await expect(page.getByRole('tab', { name: /^Work/ })).toHaveAttribute('tabindex', '-1');
  await openPortTab(page, 'Refuel');
});

test('a map place opens with Enter and the Guide search works from the keyboard', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/map');
  const place = page.locator('svg g[role="button"]').first();
  await place.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();

  await page.goto('/guide');
  const box = page.getByRole('searchbox', { name: 'Search the guide' });
  await box.fill('rarity');
  await expect(page.getByTestId('guide-results')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(box).toHaveValue('');
  await box.fill('rarity');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('guide-topic')).toBeVisible();
});

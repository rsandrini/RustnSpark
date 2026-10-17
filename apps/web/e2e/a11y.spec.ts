import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import { openPortTab, registerAndLaunch } from './support';

/**
 * Accessibility in a real browser (phase 4, H3): axe-core with every rule, colour contrast included (jsdom
 * cannot compute it), over each redesigned screen and the states a pilot reaches: both widths, English.
 * All violations of the run are collected and reported together.
 */
const found: string[] = [];

async function audit(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(400);
  await page.evaluate(axe.source);
  const results = await page.evaluate(async () => {
    // @ts-expect-error axe is injected by the line above
    const outcome = await window.axe.run(document, { resultTypes: ['violations'] });
    return outcome.violations.map((violation: { id: string; impact: string; nodes: { target: string[] }[] }) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
      count: violation.nodes.length,
    }));
  });
  for (const violation of results) {
    found.push(
      `${label}: ${violation.id} (${violation.impact}, ${violation.count}) ${violation.targets.join(' | ')}`,
    );
  }
}

test('signed-out screens', async ({ page }) => {
  for (const path of ['/login', '/register', '/forgot-password']) {
    await page.goto(path);
    await audit(page, path);
  }
});

test('the game screens and their states', async ({ page }, info) => {
  const width = info.project.name;
  await registerAndLaunch(page, 'luna');

  // ship, with the tutorial card open (desktop) or as a pill (phone)
  await page.goto('/ship');
  await expect(page.getByRole('heading', { name: 'My Ship' })).toBeVisible();
  await audit(page, `${width} /ship`);
  await page.getByRole('tab', { name: 'Store' }).click();
  await audit(page, `${width} /ship store`);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await audit(page, `${width} account menu open`);
  await page.keyboard.press('Escape');

  // port
  await page.goto('/port');
  await audit(page, `${width} /port market`);
  for (const tab of ['Your goods', 'Repair', 'Refuel', 'Upgrade', 'Scavenging']) {
    await openPortTab(page, tab);
    await audit(page, `${width} /port ${tab}`);
  }

  // missions: the rows, and one open
  await page.goto('/missions');
  await expect(page.locator('.mrow').first()).toBeVisible();
  await audit(page, `${width} /missions`);
  await page.locator('.mrow-details summary').first().click();
  await audit(page, `${width} /missions details open`);

  // map: nothing selected, then a place
  await page.goto('/map');
  await audit(page, `${width} /map`);
  await page.goto('/map?place=ceres');
  await audit(page, `${width} /map place`);

  // guide
  await page.goto('/guide/fuel');
  await audit(page, `${width} /guide topic`);
  await page.goto('/guide');
  await page.getByRole('searchbox', { name: 'Search the guide' }).fill('shield');
  await audit(page, `${width} /guide search`);

  // a flown mission gives the report and the profile history
  await page.goto('/missions');
  await page.locator('button:has-text("Accept"):not([disabled])').first().click();
  await page.getByRole('button', { name: 'Dispatch' }).click();
  await expect(page).toHaveURL(/\/report\//, { timeout: 90_000 });
  await expect(page.getByTestId('debrief')).toBeVisible();
  await audit(page, `${width} report overview`);
  await page.getByRole('tab', { name: 'The story' }).click();
  await audit(page, `${width} report story`);
  await page.getByRole('tab', { name: 'Log' }).click();
  await audit(page, `${width} report log`);
  await page.goto('/profile');
  await audit(page, `${width} /profile`);
});

test.afterAll(() => {
  expect(found, `axe violations:\n${found.join('\n')}`).toEqual([]);
});
